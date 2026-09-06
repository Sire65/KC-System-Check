-- Leitstand-Zugang: wer den LIVE-Leitstand sehen darf und in welcher Rolle.
-- Ohne Eintrag in dieser Tabelle liefert die Edge Function 403 - der anon-Key
-- allein ist keine Berechtigung mehr.
create table if not exists public.kc_system_check_operators (
  user_id uuid primary key,
  role text not null check (role in ('superadmin','technik')),
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);

comment on table public.kc_system_check_operators is
  'Zugangsliste fuer den KC System Check Leitstand. superadmin sieht auch Kassenereignisse, technik nur Technikdaten.';

alter table public.kc_system_check_operators enable row level security;
revoke all on table public.kc_system_check_operators from anon, authenticated;

drop policy if exists kc_system_check_operators_deny_anon on public.kc_system_check_operators;
create policy kc_system_check_operators_deny_anon on public.kc_system_check_operators
for all to anon, authenticated
using (false)
with check (false);

-- Rollenaufloesung fuer die Edge Function. security definer, damit ausschliesslich
-- der Server ueber diese Funktion liest.
create or replace function public.kc_system_check_operator_role(p_user uuid)
returns text
language sql
security definer
set search_path = pg_catalog, public
as $$
  select role
  from public.kc_system_check_operators
  where user_id = p_user and active
  limit 1;
$$;

revoke all on function public.kc_system_check_operator_role(uuid) from public, anon, authenticated;
grant execute on function public.kc_system_check_operator_role(uuid) to service_role;

-- EINMALIGE FREISCHALTUNG nach dem Einspielen dieser Migration, sonst hat
-- niemand Zugang zum LIVE-Leitstand. E-Mail durch das eigene Superadmin-Konto
-- ersetzen und im SQL-Editor ausfuehren:
--
--   insert into public.kc_system_check_operators (user_id, role, note)
--   select id, 'superadmin', 'Erstfreischaltung'
--   from auth.users
--   where email = 'BITTE-EIGENE-ADRESSE@example.com'
--   on conflict (user_id) do update set role = excluded.role, active = true;
