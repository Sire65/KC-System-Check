-- Kalibrierung nach dem ersten Lauf gegen die echte Datenbank.
--
-- Befund: Supabase vergibt Tabellenrechte an anon/authenticated standardmaessig;
-- gedeckt werden sie durch RLS. Die erste Fassung meldete deshalb 244 Rechte als
-- Befund - unbrauchbar, weil dauerhaft rot. Ein Recht ist nur dann ein Befund,
-- wenn nichts es deckt: eine Tabelle ohne RLS, eine View mit Eigentuemerrechten
-- oder eine materialisierte View (die kann gar kein RLS).
--
-- Neu deshalb: views_bypassing_rls - genau das Muster, das wirklich ein Loch ist.
-- Ausserdem sind Policies mit using(true) jetzt eine Warnung statt einer Stoerung:
-- "alle Angemeldeten duerfen lesen" kann beabsichtigt sein und gehoert geprueft,
-- ist aber kein Ausfall.

create or replace function public.kc_system_check_security_audit()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  with objects as (
    select c.oid, c.relname, c.relkind, c.relrowsecurity,
           coalesce('security_invoker=true' = any(c.reloptions), false) as invoker
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p','v','m')
  ), tables_without_rls as (
    select relname as table_name
    from objects
    where relkind in ('r','p') and not relrowsecurity
    order by 1
  ), views_bypassing_rls as (
    select o.relname || case when o.relkind = 'm' then ' (materialisiert)' else ' (View mit Eigentuemerrechten)' end as view_name
    from objects o
    where (o.relkind = 'v' and not o.invoker) or o.relkind = 'm'
      and exists (
        select 1 from information_schema.role_table_grants g
        where g.table_schema = 'public' and g.table_name = o.relname
          and g.grantee in ('anon','authenticated')
      )
    order by 1
  ), permissive_policies as (
    select schemaname || '.' || tablename || ' · ' || policyname as policy_name
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')
      and ('anon' = any(roles) or 'authenticated' = any(roles) or 'public' = any(roles))
    order by 1
  ), public_grants as (
    -- nur Rechte, die durch nichts gedeckt sind
    select g.grantee || ': ' || g.table_name || ' (' || g.privilege_type || ')' as grant_name
    from information_schema.role_table_grants g
    join objects o on o.relname = g.table_name
    where g.table_schema = 'public'
      and g.grantee in ('anon','authenticated')
      and g.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE')
      and ( (o.relkind in ('r','p') and not o.relrowsecurity)
         or (o.relkind = 'v' and not o.invoker)
         or o.relkind = 'm' )
    order by 1
  )
  select jsonb_build_object(
    'checked_at', now(),
    'tables_without_rls', coalesce((select jsonb_agg(table_name) from tables_without_rls), '[]'::jsonb),
    'views_bypassing_rls', coalesce((select jsonb_agg(view_name) from views_bypassing_rls), '[]'::jsonb),
    'permissive_policies', coalesce((select jsonb_agg(policy_name) from permissive_policies), '[]'::jsonb),
    'public_grants', coalesce((select jsonb_agg(grant_name) from public_grants), '[]'::jsonb)
  );
$$;

revoke all on function public.kc_system_check_security_audit() from public, anon, authenticated;
grant execute on function public.kc_system_check_security_audit() to service_role;
