-- Produktiv im Projekt Future Academy installiert.
-- Gibt ausschließlich technische Kapazitätsdaten zurück; keine Nutzerdaten.
create or replace function public.kc_system_check_public_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'public_tables', (select count(*) from pg_tables where schemaname='public'),
    'checked_at', now()
  );
$$;
revoke all on function public.kc_system_check_public_snapshot() from public;
grant execute on function public.kc_system_check_public_snapshot() to anon, authenticated;
