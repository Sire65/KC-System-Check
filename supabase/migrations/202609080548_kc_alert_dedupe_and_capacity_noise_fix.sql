-- KC System Check: Alarmflut verhindern und bekannten Retention-Leerraum nicht als Stoerung werten.
--
-- 1) Die Live-Betriebskanaele hatten im Gegensatz zu system_warning/system_error
--    keine zweite Deduplizierung im KC Communicator. Eine erneut bestaetigte
--    Warnung konnte deshalb erneut als Push UND E-Mail zugestellt werden.
--
-- 2) kc_db_mirror_runs wird absichtlich auf 14 Tage begrenzt. Durch den
--    taeglichen Retention-Lauf entsteht dort wiederverwendbarer Leerraum. Das
--    ist bei dieser Tabelle Betriebszustand und kein Kapazitaetsvorfall.

update public.kc_communication_event_rules
set conditions = coalesce(conditions, '{}'::jsonb) || '{"dedupeSeconds":21600}'::jsonb,
    updated_at = now()
where source_program = 'kc-system-check'
  and event_key in ('live_operation_warning','live_operation_error','live_operation_recovered');

create or replace function public.kc_system_check_db_capacity()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  with d as (
    select db_monitor.capacity('public') as v
  ), filtered as (
    select jsonb_set(
      v,
      '{bloat}',
      coalesce((
        select jsonb_agg(x)
        from jsonb_array_elements(coalesce(v -> 'bloat', '[]'::jsonb)) x
        where x ->> 'table' <> 'kc_db_mirror_runs'
      ), '[]'::jsonb),
      true
    ) as v
    from d
  )
  select v from filtered;
$$;

revoke all on function public.kc_system_check_db_capacity() from public, anon, authenticated;
grant execute on function public.kc_system_check_db_capacity() to service_role;
