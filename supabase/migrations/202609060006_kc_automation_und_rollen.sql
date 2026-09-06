-- Zwei Korrekturen nach dem Blick in die beiden Funktionen, die nicht im
-- Repository liegen (kc-live-operations-watch, kc-system-check-alerts):
--
-- 1. Rollen zusammenfuehren. kc_core_user_links ist die bestehende KC-weite
--    Rollenliste; kc_system_check_operators war daneben eine zweite fuer
--    dieselbe Frage. Ab jetzt zaehlt beides, mit kc_core_user_links als
--    Grundlage - wer dort admin oder superadmin ist, braucht keinen zweiten
--    Eintrag. Die System-Check-Liste bleibt nur fuer Personen, die
--    ausschliesslich hier Zugang bekommen sollen (Rolle technik).
--
-- 2. Eine eigene Kennung fuer die Automatik. Die Zeitplaene meldeten sich
--    bisher mit dem oeffentlichen Schluessel an - deshalb mussten die
--    Endpunkte fuer jeden offenstehen. Der Schluessel bleibt als
--    Gateway-Schluessel noetig, die Berechtigung kommt jetzt aus einem
--    eigenen Geheimnis, das ausschliesslich in der Datenbank liegt.

create or replace function public.kc_system_check_operator_role(p_user uuid)
returns text
language sql
security definer
set search_path = pg_catalog, public
as $$
  select role from (
    -- Eigene System-Check-Liste hat Vorrang (erlaubt gezielt die Rolle technik)
    select role, 1 as rang
    from public.kc_system_check_operators
    where user_id = p_user and active
    union all
    -- Bestehende KC-Rollenliste: Admins sind auch hier Superadmins
    select 'superadmin', 2
    from public.kc_core_user_links
    where user_id = p_user and active and core_role in ('admin','superadmin')
  ) x
  order by rang
  limit 1;
$$;

revoke all on function public.kc_system_check_operator_role(uuid) from public, anon, authenticated;
grant execute on function public.kc_system_check_operator_role(uuid) to service_role;

create table if not exists public.kc_automation_credentials (
  name text primary key,
  token_sha256 text not null,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

comment on table public.kc_automation_credentials is
  'Kennungen fuer serverseitige Zeitplaene. Es wird nur der SHA-256-Abdruck gespeichert, nie das Geheimnis selbst.';

alter table public.kc_automation_credentials enable row level security;
revoke all on table public.kc_automation_credentials from anon, authenticated;

drop policy if exists kc_automation_credentials_deny_anon on public.kc_automation_credentials;
create policy kc_automation_credentials_deny_anon on public.kc_automation_credentials
for all to anon, authenticated
using (false)
with check (false);

-- Prueft eine Kennung und vermerkt die Nutzung. Gibt nur wahr oder falsch zurueck.
create or replace function public.kc_automation_verify(p_name text, p_token text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_ok boolean := false;
begin
  if p_token is null or length(p_token) < 32 then
    return false;
  end if;
  update public.kc_automation_credentials
     set last_used_at = now()
   where name = p_name
     and active
     and token_sha256 = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

revoke all on function public.kc_automation_verify(text, text) from public, anon, authenticated;
grant execute on function public.kc_automation_verify(text, text) to service_role;
