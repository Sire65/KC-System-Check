-- Der Beweis fuer die Portabilitaet: eine leere Datenbank, in der NUR die
-- Migrationen dieses Programms liegen. Keine KC-Tabellen, keine Spiegelung,
-- keine Sicherung, kein zweites Projekt - so, wie es bei einem Kollegen
-- aussieht, der das Programm uebernimmt.
--
-- Bricht hier etwas ab, kann er es nicht einrichten.
\set ON_ERROR_STOP on
\set QUIET on

do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;

-- Die Migrationen, die eine fremde Umgebung braucht. Bewusst OHNE die
-- KC-eigenen Tabellen: was die voraussetzt, gehoert nicht zum Grundgeruest.
\i supabase/migrations/202609010510_kc_system_check_history_v1.sql
\i supabase/migrations/202609010516_kc_system_check_history_explicit_deny.sql
\i supabase/migrations/202609060001_kc_system_check_operators.sql
\i supabase/migrations/202609060002_kc_system_check_audit.sql
\i supabase/migrations/202609060003_kc_alarm_quality.sql
\i supabase/migrations/202609060011_db_monitor_paket.sql
\i supabase/migrations/202609060012_kc_externe_zugaenge.sql
\i supabase/migrations/202609060013_db_monitor_paket_v2.sql
\i supabase/migrations/202609060014_kc_alarmregelwerk_gemeinsam.sql
\i supabase/migrations/202609060015_kc_erste_messung_meldet_nicht.sql
\i supabase/migrations/202609060016_kc_alarmregelwerk_sicherung.sql
\i supabase/migrations/202609060019_kc_portabilitaet_zugaenge.sql

-- 1. Die Sicherheits- und Kapazitaetspruefung laeuft ohne jede KC-Tabelle
do $$
declare s jsonb := public.kc_system_check_security_audit();
        c jsonb := public.kc_system_check_db_capacity();
begin
  assert s ? 'tables_without_rls', 'Die Sicherheitspruefung antwortet nicht';
  assert c ? 'connections', 'Die Kapazitaetspruefung antwortet nicht';
end $$;

-- 2. Das Alarmregelwerk gilt auch hier, ohne dass jemand etwas eintraegt
do $$
declare v jsonb;
begin
  v := public.kc_system_check_alarm_apply('[{"id":"probe","name":"Probe","status":"critical"}]'::jsonb);
  assert v -> 'notify' = '[]'::jsonb, 'Erste Messung meldet nicht';
  v := public.kc_system_check_alarm_apply('[{"id":"probe","name":"Probe","status":"critical"}]'::jsonb);
  assert jsonb_array_length(v -> 'notify') = 1, 'Zweite Messung meldet';
end $$;

-- 3. Ohne hinterlegte Zugaenge kommt eine leere Sammlung - kein Fehler,
--    und vor allem keine fremde Adresse.
do $$
declare v jsonb;
begin
  delete from public.kc_external_credentials;
  v := public.kc_external_credentials();
  assert v = '{}'::jsonb, 'Ohne Eintraege muss die Sammlung leer sein, war: ' || v::text;
end $$;

-- 4. Ein eigener Zugang wird sauber zurueckgegeben, mit Anzeigename
insert into public.kc_external_credentials (name, kind, endpoint, secret, label)
values ('github_repo','github_api','https://api.github.com/repos/kollege/sein-repo','','Sein Repository');
do $$
declare v jsonb := public.kc_external_credentials();
begin
  assert v -> 'github_repo' ->> 'endpoint' = 'https://api.github.com/repos/kollege/sein-repo',
    'Der eigene Zugang kommt nicht zurueck';
  assert v -> 'github_repo' ->> 'label' = 'Sein Repository', 'Der Anzeigename fehlt';
  assert not (v::text like '%Sire65%'), 'In einer fremden Umgebung darf keine fremde Adresse auftauchen';
end $$;

-- 5. Auch hier gilt: nur der Dienst kommt an die Zugaenge
do $$ begin
  assert not has_function_privilege('anon', 'public.kc_external_credentials()', 'execute'),
    'anon darf die Zugaenge abrufen';
  assert not has_function_privilege('authenticated', 'public.kc_external_credentials()', 'execute'),
    'authenticated darf die Zugaenge abrufen';
end $$;

-- 6. Die abgeloeste Einzelfunktion ist wirklich weg
do $$ begin
  assert to_regprocedure('public.kc_external_credential(text)') is null,
    'Die alte Einzelfunktion steht noch daneben';
end $$;

\echo 'fremde Umgebung: alle Annahmen erfuellt'
