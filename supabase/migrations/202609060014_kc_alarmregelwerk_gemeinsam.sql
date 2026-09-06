-- Ein Regelwerk, ein Ort - und die Alarmierung benutzt es endlich.
--
-- Zwei Befunde, die zusammengehoeren:
--
-- 1. config/alarm-policy.json galt nur in der App. kc-live-operations-watch
--    ruft kc_system_check_alarm_apply() mit p_policy:{} auf, serverseitig
--    galten also die eingebauten Vorgaben - und 'dependencies' war dort leer.
--    Ab jetzt liegt das Regelwerk in der Datenbank und wird benutzt, wenn der
--    Aufrufer keins mitgibt. Der Inhalt ist Zeichen fuer Zeichen der von
--    config/alarm-policy.json; ein Test wacht darueber.
--
-- 2. Schlimmer: kc-system-check-alerts hat das Regelwerk nie aufgerufen. Die
--    Alarmierung, die tatsaechlich als Push und E-Mail ankommt, entschied
--    allein aus dem Sprung des Gesamtzustands. Kein Entprellen, keine
--    Abhaengigkeiten, kein Wartungsfenster. Ein einzelner Aussetzer genuegte
--    fuer eine Meldung - genau das, wogegen Migration 202609060003 gebaut
--    wurde. Deren eigener Kopf behauptete bereits das Gegenteil.
--
-- Neu in der Auswertung:
--   renotifyStatuses  Nur diese Zustaende werden nach renotifyAfterMinutes
--                     erneut gemeldet. Eine offene Warnung ist eine Aufgabe,
--                     kein Vorfall; stuendlich wiederholt liest sie niemand.
--                     Ohne diese Regel meldet die bewusst offene
--                     GitHub-Warnung ab sofort jede Stunde.
--   recovered         Entwarnung gehoert in dieselbe Auswertung wie der Alarm.
--                     Gemeldet wird sie nur fuer Signale, fuer die vorher auch
--                     wirklich alarmiert wurde - sonst entwarnt das System vor
--                     etwas, wovon niemand erfahren hat.

create table if not exists public.kc_system_check_alarm_policy (
  id text primary key,
  policy jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table public.kc_system_check_alarm_policy is
  'Alarmregelwerk fuer die Serverseite. Inhaltsgleich mit config/alarm-policy.json, das die App liest.';

alter table public.kc_system_check_alarm_policy enable row level security;
revoke all on table public.kc_system_check_alarm_policy from anon, authenticated;
grant select, insert, update on table public.kc_system_check_alarm_policy to service_role;

drop policy if exists kc_system_check_alarm_policy_deny_client on public.kc_system_check_alarm_policy;
create policy kc_system_check_alarm_policy_deny_client on public.kc_system_check_alarm_policy
for all to anon, authenticated
using (false)
with check (false);

insert into public.kc_system_check_alarm_policy (id, policy)
values ('default', '{
  "note": "Alarmregeln als Konfiguration, nicht als Code. dependencies nennt je Signal die Voraussetzungen: faellt eine davon aus, ist das Signal ein Folgealarm und wird unterdrueckt. renotifyStatuses bestimmt, welche Zustaende nach renotifyAfterMinutes erneut gemeldet werden - eine offene Warnung ist eine Aufgabe, kein Vorfall, und wird nicht stuendlich wiederholt.",
  "confirmAfter": {
    "critical": 2,
    "warning": 2,
    "unknown": 3,
    "healthy": 3
  },
  "renotifyAfterMinutes": 60,
  "renotifyStatuses": [
    "critical"
  ],
  "escalateAfterMinutes": 15,
  "dependencies": {
    "mirror": [
      "kc_core",
      "neon"
    ],
    "db_security": [
      "kc_core"
    ],
    "db_capacity": [
      "kc_core"
    ],
    "future_academy": [],
    "neon": [],
    "b2": [],
    "r2": [],
    "oci": [],
    "github": [],
    "endpoint_exposure": [],
    "key_lifetime": []
  }
}'::jsonb)
on conflict (id) do update set policy = excluded.policy, updated_at = now();

create or replace function public.kc_system_check_alarm_apply(p_signals jsonb, p_policy jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := now();
  -- Gibt der Aufrufer nichts mit, gilt das hinterlegte Regelwerk. Erst wenn
  -- auch das fehlt, greifen die eingebauten Vorgaben.
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
  v_alarms jsonb := '[]'::jsonb;
  v_suppressed jsonb := '[]'::jsonb;
  v_notify jsonb := '[]'::jsonb;
  v_recovered jsonb := '[]'::jsonb;
  v_parent text;
  v_blocked text;
  v_open integer;
begin
  -- Schritt 1: Entprellung je Signal
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
      insert into public.kc_system_check_alarm_state (signal_id, confirmed, candidate, streak, since, updated_at)
      values (v_id, v_status, null, 0, v_now, v_now)
      returning * into v_row;
      v_changed := true;
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
        v_row.since := v_now;
        v_changed := true;
      end if;
      update public.kc_system_check_alarm_state
        set confirmed = v_row.confirmed, candidate = v_row.candidate, streak = v_row.streak,
            since = v_row.since, updated_at = v_now
        where signal_id = v_id;
    else
      update public.kc_system_check_alarm_state
        set candidate = null, streak = 0, updated_at = v_now
        where signal_id = v_id;
      v_row.candidate := null;
      v_row.streak := 0;
    end if;

    if v_row.confirmed = 'healthy' then
      -- Entwarnung nur, wenn vorher wirklich alarmiert wurde, und nicht
      -- waehrend eines laufenden Wartungsfensters.
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

    -- Schritt 2: Wartungsfenster
    if v_row.suppressed_until is not null and v_row.suppressed_until > v_now then
      v_suppressed := v_suppressed || jsonb_build_object('id', v_id, 'status', v_row.confirmed, 'reason', 'wartung', 'until', v_row.suppressed_until);
      continue;
    end if;

    -- Schritt 3: Folgealarme unterdruecken
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

    if v_changed
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
