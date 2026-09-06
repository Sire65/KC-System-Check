-- Portabilitaet: was fest im Quelltext stand, wird Konfiguration.
--
-- Drei Stellen banden das Programm an genau diese Umgebung:
--   GITHUB_REPO   api.github.com/repos/Sire65/KC-System-Check
--   FUTURE_URL    iddudrxuihdodnvejxcp.supabase.co
--   FUTURE_KEY    der zugehoerige oeffentliche Schluessel
-- Wer das Programm uebernimmt, haette den Quelltext aendern muessen - und
-- haette bis dahin das Repository und die Datenbank eines Fremden ueberwacht.
--
-- Beides wandert in kc_external_credentials, die es fuer genau diesen Zweck
-- schon gibt. Fehlt ein Eintrag, meldet die Kachel "nicht eingerichtet" statt
-- auf eine fremde Adresse zu zeigen.
--
-- Statt drei Einzelabfragen liefert eine Funktion alle Zugaenge auf einmal.
-- Die alte Einzelfunktion wird abgeloest; sie hatte genau einen Aufrufer.

alter table public.kc_external_credentials
  add column if not exists label text;

comment on column public.kc_external_credentials.label is
  'Anzeigename der zugehoerigen Kachel. Ohne ihn steht dort eine neutrale Bezeichnung.';

create or replace function public.kc_external_credentials()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v jsonb;
begin
  select coalesce(jsonb_object_agg(name, jsonb_build_object(
           'kind', kind, 'endpoint', endpoint, 'secret', secret, 'label', label)), '{}'::jsonb)
    into v
  from public.kc_external_credentials
  where active;

  update public.kc_external_credentials set last_used_at = now() where active;
  return v;
end;
$$;

comment on function public.kc_external_credentials() is
  'Alle aktiven Zugaenge in einem Aufruf. Ausschliesslich fuer service_role - der Inhalt darf nie in eine Antwort an den Browser gelangen.';

revoke all on function public.kc_external_credentials() from public, anon, authenticated;
grant execute on function public.kc_external_credentials() to service_role;

drop function if exists public.kc_external_credential(text);

-- Die bisher fest verdrahteten Werte, damit sich fuer diese Umgebung nichts
-- aendert. In einer fremden Umgebung fehlen sie schlicht.
insert into public.kc_external_credentials (name, kind, endpoint, secret, note) values
  ('github_repo', 'github_api', 'https://api.github.com/repos/Sire65/KC-System-Check', '',
   'Leeres Geheimnis = unangemeldeter Zugriff auf die oeffentliche GitHub-API. Ein Token erhoeht nur das Ratenlimit.'),
  ('future_academy', 'supabase_rest', 'https://iddudrxuihdodnvejxcp.supabase.co', 'sb_publishable_DWLycZijZEBvakXVncI5IQ_38LZCQxW',
   'Zweites Supabase-Projekt. Oeffentlicher Schluessel - er stand bisher im Quelltext und ist damit ohnehin bekannt.')
on conflict (name) do update
  set kind = excluded.kind, endpoint = excluded.endpoint, secret = excluded.secret, note = excluded.note, active = true;

update public.kc_external_credentials set label = 'Future Academy · Supabase' where name = 'future_academy';
