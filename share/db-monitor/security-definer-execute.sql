-- Additive SECURITY DEFINER execute audit for PostgreSQL/Supabase.
-- Read-only catalogue inspection. It does not change application grants.
create schema if not exists db_monitor;

create or replace function db_monitor.security_definer_execute_audit(
  p_schema text default 'public',
  p_client_roles text[] default array['anon','authenticated']
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with client_roles as (
    select r.oid, r.rolname
    from pg_roles r
    where r.rolname = any(p_client_roles)
  ), definer_functions as (
    select p.oid, n.nspname as object_schema, p.proname as object_name,
           pg_get_function_identity_arguments(p.oid) as identity_arguments
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = p_schema and p.prosecdef
  ), direct_grants as (
    select f.object_schema, f.object_name, f.identity_arguments, cr.rolname as role_name
    from definer_functions f
    cross join client_roles cr
    where has_function_privilege(cr.oid, f.oid, 'EXECUTE')
  ), findings as (
    select object_schema, object_name, identity_arguments, role_name,
           'security_definer_' || role_name || '_execute' as finding_code
    from direct_grants
  )
  select jsonb_build_object(
    'checked_at', now(),
    'schema', p_schema,
    'client_roles', to_jsonb(p_client_roles),
    'findings', coalesce(jsonb_agg(jsonb_build_object(
      'object_schema', object_schema,
      'object_name', object_name,
      'object_type', 'function',
      'identity_arguments', identity_arguments,
      'role', role_name,
      'finding_code', finding_code
    ) order by object_schema, object_name, role_name), '[]'::jsonb)
  )
  from findings;
$$;

-- The monitor remains server-side only. PostgreSQL grants EXECUTE to PUBLIC on
-- new functions by default, so revoke it explicitly after creation.
revoke all on function db_monitor.security_definer_execute_audit(text,text[]) from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then
    revoke all on function db_monitor.security_definer_execute_audit(text,text[]) from anon;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    revoke all on function db_monitor.security_definer_execute_audit(text,text[]) from authenticated;
  end if;
end $$;
