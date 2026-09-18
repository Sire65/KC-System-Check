\set ON_ERROR_STOP on
\set QUIET on

\i share/db-monitor/install.sql
\i share/db-monitor/security-definer-execute.sql

do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;

create or replace function public.probe_definer()
returns int language sql security definer set search_path = '' as 'select 1';
revoke all on function public.probe_definer() from public;
grant execute on function public.probe_definer() to anon;

do $$
declare v jsonb := db_monitor.security_definer_execute_audit();
begin
  assert v -> 'findings' @> '[{"object_schema":"public","object_name":"probe_definer","role":"anon","finding_code":"security_definer_anon_execute"}]'::jsonb,
    'anon SECURITY DEFINER execute grant was not emitted as structured finding: ' || (v -> 'findings')::text;
  assert not (v -> 'findings' @> '[{"object_name":"probe_definer","role":"authenticated"}]'::jsonb),
    'authenticated was reported without execute privilege';
end $$;

grant execute on function public.probe_definer() to authenticated;
do $$
declare v jsonb := db_monitor.security_definer_execute_audit();
begin
  assert v -> 'findings' @> '[{"object_name":"probe_definer","role":"authenticated","finding_code":"security_definer_authenticated_execute"}]'::jsonb,
    'authenticated SECURITY DEFINER execute grant missing';
end $$;

revoke execute on function public.probe_definer() from anon, authenticated;
do $
declare v jsonb := db_monitor.security_definer_execute_audit();
begin
  assert jsonb_array_length(v -> 'findings') = 0,
    'revoked execute privilege must remove finding: ' || (v -> 'findings')::text;
end $;

-- has_function_privilege() measures effective privilege. A PUBLIC EXECUTE grant
-- must therefore be visible for both client roles, just like the Supabase advisor.
grant execute on function public.probe_definer() to public;
do $
declare v jsonb := db_monitor.security_definer_execute_audit();
begin
  assert v -> 'findings' @> '[{"object_name":"probe_definer","role":"anon"}]'::jsonb,
    'PUBLIC execute must be effective for anon';
  assert v -> 'findings' @> '[{"object_name":"probe_definer","role":"authenticated"}]'::jsonb,
    'PUBLIC execute must be effective for authenticated';
end $;
revoke execute on function public.probe_definer() from public;

-- The audit function itself must never become a client-callable surface.
do $$
begin
  assert not has_function_privilege('anon','db_monitor.security_definer_execute_audit(text,text[])','execute'),
    'audit function is executable by anon';
  assert not has_function_privilege('authenticated','db_monitor.security_definer_execute_audit(text,text[])','execute'),
    'audit function is executable by authenticated';
  assert not has_function_privilege('public','db_monitor.security_definer_execute_audit(text,text[])','execute'),
    'audit function is executable by PUBLIC';
end $$;

\echo 'security-definer-execute: alle Annahmen erfuellt'
