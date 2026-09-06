-- Ein neues Signal uebersprang die Entprellung.
--
-- Aus dem Betrieb, 2026-09-06 10:00 Uhr: der erste scharfe Lauf der neuen
-- Alarmierung legte fuer jede Kachel einen Zustand an. Die Neon-Kachel war
-- brandneu und stand fuer genau eine Messung auf "1 Tabelle mit echtem
-- Vacuum-Rueckstand" - beim naechsten Lauf war sie wieder gruen. Die Meldung
-- war da schon raus.
--
-- Grund: beim Anlegen setzte die Auswertung v_changed := true, und v_changed
-- meldet. Fuer ein Signal ohne Vorgeschichte heisst das: eine einzige Messung
-- genuegt - genau das, was confirmAfter ausschliessen soll.
--
-- Neu: beim Anlegen wird der Zustand uebernommen, aber nicht gemeldet.
-- streak zaehlt ab jetzt im Gleichstand mit, wie oft der bestaetigte Zustand
-- in Folge gesehen wurde. Ein Zustand, der noch nie gemeldet wurde, wird
-- faellig, sobald er so oft bestaetigt ist wie ein Wechsel es waere. Damit
-- meldet auch ein System, das von Anfang an gestoert ist - nur eine Messung
-- spaeter. Dauerhaft stumm bleibt nichts.
--
-- Gezaehlt wird in einer eigenen Spalte. Der erste Versuch benutzte dafuer
-- streak - das zaehlt aber im Wechselfall die Messungen des KANDIDATEN, nicht
-- des bestaetigten Zustands. Folge: ein Signal, das gerade von warning nach
-- healthy wechselte, meldete auf dem Weg dorthin seine alte Warnung nach. Der
-- SQL-Test hat das beim ersten Lauf aufgedeckt.

alter table public.kc_system_check_alarm_state
  add column if not exists confirmed_seen integer not null default 1;

comment on column public.kc_system_check_alarm_state.confirmed_seen is
  'Wie oft der bestaetigte Zustand in Folge gemessen wurde. Getrennt von streak, das die Messungen des Kandidaten zaehlt.';

create or replace function public.kc_system_check_alarm_apply(p_signals jsonb, p_policy jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := now();
  v_policy jsonb := coalesce(
    nullif(p_policy, '{}'::jsonb),
    (select policy from public.kc_system_check_alarm_policy where id = 'default'),
    '{}'::jsonb);
  v_confirm jsonb := coalesce(v_policy -> 'confirmAfter', '{"critical":2,"warning":2,"unknown":3,"healthy":3}'::jsonb);
  v_deps jsonb := coalesce(v_policy -> 'dependencies', '{}'::jsonb);
  v_renotify integer := coalesce((v_policy ->> 'renotifyAfterMinutes')::int, 60);
  v_renotify_for jsonb := coalesce(v_policy -> 'renotifyStatuses', '["critical"]'::jsonb);
  v_escalate integer := coalesce((v_policy ->> 'escalateAfterMinutes')::int, 15);
  v_signal jsonb;
  v_id text;
  v_status text;
  v_needed integer;
  v_row public.kc_system_check_alarm_state%rowtype;
  v_changed boolean;
  v_faellig boolean;
  v_alarms jsonb := '[]'::jsonb;
  v_suppressed jsonb := '[]'::jsonb;
  v_notify jsonb := '[]'::jsonb;
  v_recovered jsonb := '[]'::jsonb;
  v_parent text;
  v_blocked text;
  v_open integer;
begin
  for v_signal in select * from jsonb_array_elements(coalesce(p_signals, '[]'::jsonb)) loop
    v_id := v_signal ->> 'id';
    v_status := lower(coalesce(v_signal ->> 'status', 'unknown'));
    v_status := case
      when v_status in ('critical','bad','down','error','failed') then 'critical'
      when v_status in ('warning','warn','degraded') then 'warning'
      when v_status in ('healthy','ok','success','passed') then 'healthy'
      else 'unknown' end;
    continue when v_id is null;

    select * into v_row from public.kc_system_check_alarm_state where signal_id = v_id;
    v_changed := false;

    if not found then
      -- Zustand uebernehmen, aber nicht melden: einmal gesehen ist nicht genug.
      insert into public.kc_system_check_alarm_state (signal_id, confirmed, candidate, streak, confirmed_seen, since, updated_at)
      values (v_id, v_status, null, 0, 1, v_now, v_now)
      returning * into v_row;
    elsif v_row.confirmed is distinct from v_status then
      v_needed := coalesce((v_confirm ->> v_status)::int, 2);
      if v_row.candidate is not distinct from v_status then
        v_row.streak := v_row.streak + 1;
      else
        v_row.candidate := v_status;
        v_row.streak := 1;
      end if;
      if v_row.streak >= v_needed then
        v_row.confirmed := v_status;
        v_row.candidate := null;
        v_row.streak := 0;
        v_row.confirmed_seen := 1;
        v_row.since := v_now;
        v_changed := true;
      end if;
      update public.kc_system_check_alarm_state
        set confirmed = v_row.confirmed, candidate = v_row.candidate, streak = v_row.streak,
            confirmed_seen = v_row.confirmed_seen, since = v_row.since, updated_at = v_now
        where signal_id = v_id;
    else
      -- Gleichstand: der bestaetigte Zustand wurde ein weiteres Mal gesehen.
      v_row.candidate := null;
      v_row.streak := 0;
      v_row.confirmed_seen := v_row.confirmed_seen + 1;
      update public.kc_system_check_alarm_state
        set candidate = null, streak = 0, confirmed_seen = v_row.confirmed_seen, updated_at = v_now
        where signal_id = v_id;
    end if;

    if v_row.confirmed = 'healthy' then
      if v_changed and v_row.last_notified_at is not null
         and (v_row.suppressed_until is null or v_row.suppressed_until <= v_now) then
        v_recovered := v_recovered || jsonb_build_object(
          'id', v_id, 'name', coalesce(v_signal ->> 'name', v_id), 'status', 'healthy');
      end if;
      if v_changed then
        update public.kc_system_check_alarm_state set last_notified_at = null where signal_id = v_id;
      end if;
      continue;
    end if;

    if v_row.suppressed_until is not null and v_row.suppressed_until > v_now then
      v_suppressed := v_suppressed || jsonb_build_object('id', v_id, 'status', v_row.confirmed, 'reason', 'wartung', 'until', v_row.suppressed_until);
      continue;
    end if;

    v_blocked := null;
    for v_parent in select jsonb_array_elements_text(coalesce(v_deps -> v_id, '[]'::jsonb)) loop
      if exists (select 1 from public.kc_system_check_alarm_state where signal_id = v_parent and confirmed = 'critical') then
        v_blocked := v_parent;
        exit;
      end if;
    end loop;
    if v_blocked is not null then
      v_suppressed := v_suppressed || jsonb_build_object('id', v_id, 'status', v_row.confirmed, 'reason', 'abhaengigkeit', 'causedBy', v_blocked);
      continue;
    end if;

    v_open := greatest(0, (extract(epoch from v_now - v_row.since) / 60)::int);
    v_alarms := v_alarms || jsonb_build_object(
      'id', v_id,
      'name', coalesce(v_signal ->> 'name', v_id),
      'status', v_row.confirmed,
      'since', v_row.since,
      'openMinutes', v_open,
      'escalated', v_row.confirmed = 'critical' and v_open >= v_escalate,
      'isNew', v_changed
    );

    -- Noch nie gemeldet und oft genug bestaetigt: jetzt faellig.
    v_faellig := v_row.last_notified_at is null
                 and v_row.confirmed_seen >= coalesce((v_confirm ->> v_row.confirmed)::int, 2);

    if v_changed or v_faellig
       or (v_row.last_notified_at is not null
           and v_renotify_for ? v_row.confirmed
           and v_row.last_notified_at < v_now - make_interval(mins => v_renotify)) then
      v_notify := v_notify || jsonb_build_object('id', v_id, 'name', coalesce(v_signal ->> 'name', v_id), 'status', v_row.confirmed, 'openMinutes', v_open);
      update public.kc_system_check_alarm_state set last_notified_at = v_now where signal_id = v_id;
    end if;
  end loop;

  return jsonb_build_object('checked_at', v_now, 'alarms', v_alarms, 'suppressed', v_suppressed, 'notify', v_notify, 'recovered', v_recovered);
end;
$$;

revoke all on function public.kc_system_check_alarm_apply(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.kc_system_check_alarm_apply(jsonb, jsonb) to service_role;
