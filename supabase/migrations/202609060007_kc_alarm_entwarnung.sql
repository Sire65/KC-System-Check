-- Entwarnung gehoert in dasselbe Regelwerk wie der Alarm.
-- Bisher meldete kc_system_check_alarm_apply() nur bestehende Alarme. Wer nur
-- danach handelt, daempft zwar Fehlalarme, verschluckt aber die Entwarnung -
-- der Empfaenger bliebe im Glauben, die Stoerung bestehe fort.
-- Neu: 'recovered' nennt jedes Signal, das bestaetigt wieder gesund ist UND
-- zuvor tatsaechlich gemeldet wurde. Ohne vorherige Meldung gibt es auch keine
-- Entwarnung - niemand soll Entwarnung fuer etwas bekommen, das er nie erfuhr.

create or replace function public.kc_system_check_alarm_apply(p_signals jsonb, p_policy jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := now();
  v_confirm jsonb := coalesce(p_policy -> 'confirmAfter', '{"critical":2,"warning":2,"unknown":3,"healthy":3}'::jsonb);
  v_deps jsonb := coalesce(p_policy -> 'dependencies', '{}'::jsonb);
  v_renotify integer := coalesce((p_policy ->> 'renotifyAfterMinutes')::int, 60);
  v_escalate integer := coalesce((p_policy ->> 'escalateAfterMinutes')::int, 15);
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
      -- Entwarnung nur, wenn zuvor tatsaechlich gemeldet wurde
      if v_changed and v_row.last_notified_at is not null then
        v_recovered := v_recovered || jsonb_build_object(
          'id', v_id,
          'name', coalesce(v_signal ->> 'name', v_id),
          'status', 'healthy');
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

    if v_changed or (v_row.last_notified_at is not null and v_row.last_notified_at < v_now - make_interval(mins => v_renotify)) then
      v_notify := v_notify || jsonb_build_object('id', v_id, 'name', coalesce(v_signal ->> 'name', v_id), 'status', v_row.confirmed, 'openMinutes', v_open);
      update public.kc_system_check_alarm_state set last_notified_at = v_now where signal_id = v_id;
    end if;
  end loop;

  return jsonb_build_object('checked_at', v_now, 'alarms', v_alarms, 'suppressed', v_suppressed,
                            'notify', v_notify, 'recovered', v_recovered);
end;
$$;

revoke all on function public.kc_system_check_alarm_apply(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.kc_system_check_alarm_apply(jsonb, jsonb) to service_role;
