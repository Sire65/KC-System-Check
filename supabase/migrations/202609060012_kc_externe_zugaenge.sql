-- Zugangsdaten zu fremden Systemen, die der Server selbst braucht.
--
-- kc_automation_credentials speichert nur Abdruecke - dort muss nie etwas
-- zurueckgelesen werden, es wird nur verglichen. Fuer einen Zugang zu einer
-- fremden Datenbank geht das nicht: die Zeichenkette muss im Klartext
-- vorliegen, sonst kann sich niemand damit anmelden. Deshalb eine eigene
-- Tabelle, die genau das ist und nichts anderes vorgibt.
--
-- Wer darf hinein: ausschliesslich service_role. Kein anon, kein
-- authenticated, keine Policy, die etwas durchlaesst. Der Browser sieht
-- diese Tabelle nie - der Zugang wird ausschliesslich in der Edge Function
-- benutzt und taucht in keiner Antwort auf.
--
-- Ehrlich dazugesagt, weil es die Risikolage aendert: der hier abgelegte
-- Neon-Zugang ist KEIN Lesezugang. Auf Neon kann sich nur anmelden, wer ueber
-- die Neon-API angelegt wurde, und solche Rollen sind dort immer Mitglied von
-- neon_superuser. Eine per SQL angelegte Rolle mit weniger Rechten kommt am
-- Neon-Proxy nicht vorbei - nachgeprueft, nicht vermutet. Was bleibt, ist die
-- Trennung: kc_monitor ist nicht die Kennung der Spiegelung. Faellt sie auf,
-- laesst sie sich loeschen, ohne dass die Spiegelung stehenbleibt.

create table if not exists public.kc_external_credentials (
  name text primary key,
  kind text not null,
  endpoint text not null,
  secret text not null,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

comment on table public.kc_external_credentials is
  'Zugaenge zu fremden Systemen im Klartext, ausschliesslich fuer service_role. Nie an den Browser ausliefern.';
comment on column public.kc_external_credentials.kind is
  'Wie der Zugang benutzt wird, z. B. postgres_http fuer Neons SQL-ueber-HTTP.';
comment on column public.kc_external_credentials.endpoint is
  'Erreichbare Adresse, z. B. der Neon-Compute-Host. Steht getrennt vom Geheimnis, damit Protokolle den Host nennen duerfen.';

alter table public.kc_external_credentials enable row level security;
revoke all on table public.kc_external_credentials from anon, authenticated;
grant select, insert, update, delete on table public.kc_external_credentials to service_role;

drop policy if exists kc_external_credentials_deny_client on public.kc_external_credentials;
create policy kc_external_credentials_deny_client on public.kc_external_credentials
for all to anon, authenticated
using (false)
with check (false);

-- Holt einen Zugang und vermerkt die Nutzung. Gibt nichts zurueck, wenn der
-- Eintrag fehlt oder abgeschaltet ist - dann meldet die Pruefung "nicht
-- eingerichtet" statt sich einen Zustand auszudenken.
create or replace function public.kc_external_credential(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v record;
begin
  select * into v from public.kc_external_credentials where name = p_name and active;
  if not found then return null; end if;
  update public.kc_external_credentials set last_used_at = now() where name = p_name;
  return jsonb_build_object('kind', v.kind, 'endpoint', v.endpoint, 'secret', v.secret);
end;
$$;

revoke all on function public.kc_external_credential(text) from public, anon, authenticated;
grant execute on function public.kc_external_credential(text) to service_role;
