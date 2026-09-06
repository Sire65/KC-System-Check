-- Zwei serverseitige Pruefungen, die bisher gefehlt haben:
-- 1. Sicherheitslage der Datenbank (RLS, Policies, Rechte)
-- 2. Kapazitaet jenseits der reinen Datenbankgroesse (Verbindungen,
--    groesste Tabellen, Sequenzen, Autovacuum)
-- Beide lesen nur Metadaten des Katalogs, keine Nutzdaten.

create or replace function public.kc_system_check_security_audit()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  with tables_without_rls as (
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    order by c.relname
  ), permissive_policies as (
    select schemaname || '.' || tablename || ' · ' || policyname as policy_name
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')
      and ('anon' = any(roles) or 'authenticated' = any(roles) or 'public' = any(roles))
    order by 1
  ), public_grants as (
    select grantee || ': ' || table_name || ' (' || privilege_type || ')' as grant_name
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('anon', 'authenticated')
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
    order by 1
  )
  select jsonb_build_object(
    'checked_at', now(),
    'tables_without_rls', coalesce((select jsonb_agg(table_name) from tables_without_rls), '[]'::jsonb),
    'permissive_policies', coalesce((select jsonb_agg(policy_name) from permissive_policies), '[]'::jsonb),
    'public_grants', coalesce((select jsonb_agg(grant_name) from public_grants), '[]'::jsonb)
  );
$$;

revoke all on function public.kc_system_check_security_audit() from public, anon, authenticated;
grant execute on function public.kc_system_check_security_audit() to service_role;

create or replace function public.kc_system_check_db_capacity()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  with conn as (
    select count(*)::int as used,
           coalesce(nullif(current_setting('max_connections', true), '')::int, 0) as limit_total
    from pg_stat_activity
  ), largest as (
    select c.relname as table_name, pg_total_relation_size(c.oid) as bytes
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by pg_total_relation_size(c.oid) desc
    limit 10
  ), seq as (
    select schemaname || '.' || sequencename as sequence_name,
           round((coalesce(last_value, 0)::numeric / nullif(max_value, 0)::numeric) * 100, 1) as used_percent
    from pg_sequences
    where schemaname = 'public'
      and max_value > 0
      and coalesce(last_value, 0)::numeric / nullif(max_value, 0)::numeric > 0.7
    order by 2 desc
  ), vac as (
    select relname as table_name, n_dead_tup as dead_tuples,
           greatest(coalesce(extract(epoch from now() - last_autovacuum), 0),
                    coalesce(extract(epoch from now() - last_vacuum), 0))::bigint as vacuum_age_seconds
    from pg_stat_user_tables
    where schemaname = 'public' and n_dead_tup > 1000
    order by n_dead_tup desc
    limit 5
  )
  select jsonb_build_object(
    'checked_at', now(),
    'connections', (select to_jsonb(conn) from conn),
    'largest_tables', coalesce((select jsonb_agg(jsonb_build_object('table', table_name, 'bytes', bytes)) from largest), '[]'::jsonb),
    'sequences_near_limit', coalesce((select jsonb_agg(jsonb_build_object('sequence', sequence_name, 'used_percent', used_percent)) from seq), '[]'::jsonb),
    'vacuum_backlog', coalesce((select jsonb_agg(jsonb_build_object('table', table_name, 'dead_tuples', dead_tuples, 'vacuum_age_seconds', vacuum_age_seconds)) from vac), '[]'::jsonb)
  );
$$;

revoke all on function public.kc_system_check_db_capacity() from public, anon, authenticated;
grant execute on function public.kc_system_check_db_capacity() to service_role;
