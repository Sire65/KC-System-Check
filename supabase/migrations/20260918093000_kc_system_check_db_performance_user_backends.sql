-- Exclude PostgreSQL/Supabase system backends such as WAL senders from
-- application performance warnings. They can legitimately stay active for a
-- long time while waiting for replication work.
create or replace function public.kc_system_check_db_performance()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  with app_activity as (
    select *
    from pg_stat_activity
    where datname = current_database()
      and pid <> pg_backend_pid()
      and backend_type = 'client backend'
  ),
  activity as (
    select
      count(*) filter (where state = 'active')::int as active_sessions,
      count(*) filter (where wait_event_type = 'Lock')::int as lock_waiters,
      count(*) filter (
        where state = 'active'
          and query_start is not null
          and clock_timestamp() - query_start >= interval '30 seconds'
      )::int as long_running_queries,
      coalesce(max(extract(epoch from (clock_timestamp() - query_start)) * 1000)
        filter (where state = 'active' and query_start is not null), 0)::bigint
        as longest_active_ms
    from app_activity
  ),
  blocked as (
    select count(*)::int as blocked_sessions
    from app_activity a
    where cardinality(pg_blocking_pids(a.pid)) > 0
  )
  select jsonb_build_object(
    'measured_at', clock_timestamp(),
    'active_sessions', activity.active_sessions,
    'lock_waiters', activity.lock_waiters,
    'blocked_sessions', blocked.blocked_sessions,
    'long_running_queries', activity.long_running_queries,
    'longest_active_ms', activity.longest_active_ms,
    'threshold_ms', 30000,
    'backend_scope', 'client backend',
    'query_text_exposed', false
  )
  from activity cross join blocked;
$$;

revoke all on function public.kc_system_check_db_performance() from public, anon, authenticated;
grant execute on function public.kc_system_check_db_performance() to service_role;
