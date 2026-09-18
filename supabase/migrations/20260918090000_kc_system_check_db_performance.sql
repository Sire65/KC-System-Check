-- Read-only database performance snapshot for KC System Check.
-- No query text, bind values or user data are returned.
create or replace function public.kc_system_check_db_performance()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  with activity as (
    select
      count(*) filter (where pid <> pg_backend_pid() and state = 'active')::int as active_sessions,
      count(*) filter (where pid <> pg_backend_pid() and wait_event_type = 'Lock')::int as lock_waiters,
      count(*) filter (
        where pid <> pg_backend_pid()
          and state = 'active'
          and query_start is not null
          and clock_timestamp() - query_start >= interval '30 seconds'
      )::int as long_running_queries,
      coalesce(max(extract(epoch from (clock_timestamp() - query_start)) * 1000)
        filter (where pid <> pg_backend_pid() and state = 'active' and query_start is not null), 0)::bigint
        as longest_active_ms
    from pg_stat_activity
    where datname = current_database()
  ),
  blocked as (
    select count(*)::int as blocked_sessions
    from pg_stat_activity a
    where a.datname = current_database()
      and a.pid <> pg_backend_pid()
      and cardinality(pg_blocking_pids(a.pid)) > 0
  )
  select jsonb_build_object(
    'measured_at', clock_timestamp(),
    'active_sessions', activity.active_sessions,
    'lock_waiters', activity.lock_waiters,
    'blocked_sessions', blocked.blocked_sessions,
    'long_running_queries', activity.long_running_queries,
    'longest_active_ms', activity.longest_active_ms,
    'threshold_ms', 30000,
    'query_text_exposed', false
  )
  from activity cross join blocked;
$$;

revoke all on function public.kc_system_check_db_performance() from public, anon, authenticated;
grant execute on function public.kc_system_check_db_performance() to service_role;
