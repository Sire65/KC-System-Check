create index if not exists kc_db_mirror_runs_started_at_desc_idx
  on public.kc_db_mirror_runs (started_at desc);

create or replace function public.kc_system_check_snapshot()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  with latest as (
    select status, started_at, finished_at, source_rows, target_rows,
           replication_lag_sec, mismatch_count
    from public.kc_db_mirror_runs
    order by started_at desc
    limit 1
  ), day_stats as (
    select count(*)::bigint as runs_24h,
           count(*) filter (where status is distinct from 'ok')::bigint as non_ok_24h,
           coalesce(sum(mismatch_count),0)::bigint as mismatches_24h
    from public.kc_db_mirror_runs
    where started_at >= now() - interval '24 hours'
  )
  select jsonb_build_object(
    'checked_at', now(),
    'database_bytes', pg_database_size(current_database()),
    'mirror', coalesce((select to_jsonb(latest) from latest), '{}'::jsonb),
    'runs_24h', (select runs_24h from day_stats),
    'non_ok_24h', (select non_ok_24h from day_stats),
    'mismatches_24h', (select mismatches_24h from day_stats)
  );
$$;
revoke all on function public.kc_system_check_snapshot() from public, anon, authenticated;
grant execute on function public.kc_system_check_snapshot() to service_role;
