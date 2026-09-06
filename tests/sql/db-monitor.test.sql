-- Prueft das tragbare Paket share/db-monitor/install.sql gegen eine echte
-- PostgreSQL-Instanz - einmal so, wie es auf Supabase steht (Client-Rollen
-- vorhanden), und einmal so, wie es auf einer nackten Instanz oder auf Neon
-- ohne Data API steht (die geprueften Rollen gibt es gar nicht).
-- Bricht bei der ersten falschen Annahme ab.
\set ON_ERROR_STOP on
\set QUIET on

\i share/db-monitor/install.sql

-- Ohne die Supabase-Rollen laesst sich das Paket ueberhaupt einspielen: die
-- Rechtevergabe oben fragt vorher nach, ob es die Rolle gibt. Waere das nicht
-- so, waere schon das \i oben fehlgeschlagen.

-- 1. Nackte Instanz: die geprueften Client-Rollen existieren nicht
create table public.probe_offen (id int);
create table public.probe_dicht (id int);
alter table public.probe_dicht enable row level security;
do $$
declare v jsonb := db_monitor.report('public', array['rolle_die_es_nicht_gibt']);
begin
  assert v -> 'security' ->> 'client_roles_present' = '[]',
    'Rolle faelschlich als vorhanden gemeldet: ' || (v -> 'security' ->> 'client_roles_present');
  assert v -> 'security' -> 'tables_without_rls' @> '["probe_offen"]'::jsonb,
    'Tabelle ohne RLS wurde nicht aufgefuehrt';
  -- aufgefuehrt schon, aber kein Alarm: niemand kann sie erreichen
  assert jsonb_array_length(v -> 'critical') = 0,
    'Ohne erreichbare Rolle darf nichts kritisch sein: ' || (v ->> 'critical');
  assert v ->> 'notes' like '%keine der geprüften Client-Rollen existiert%',
    'Der Grund fuer die Entwarnung fehlt im Bericht: ' || (v ->> 'notes');
end $$;

-- 2. Supabase-artig: Client-Rollen vorhanden, Recht auf einer offenen Tabelle
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
grant select on public.probe_offen to anon;
do $$
declare v jsonb := db_monitor.report();
begin
  assert v ->> 'status' = 'critical', 'Erreichbare Tabelle ohne RLS muss kritisch sein, war: ' || (v ->> 'status');
  assert v -> 'security' -> 'public_grants' is null, 'Das Paket kennt public_grants nicht - das ist der KC-Name';
  assert v -> 'security' -> 'uncovered_grants' @> '["anon: probe_offen (SELECT)"]'::jsonb,
    'Ungedecktes Recht wurde nicht gemeldet: ' || (v -> 'security' ->> 'uncovered_grants');
end $$;

-- 3. RLS deckt das Recht: kein Befund mehr
grant select on public.probe_dicht to anon;
do $$
declare v jsonb := db_monitor.security_audit();
begin
  assert not (v -> 'uncovered_grants' @> '["anon: probe_dicht (SELECT)"]'::jsonb),
    'Recht auf einer Tabelle mit RLS darf kein Befund sein';
end $$;

-- 4. Klammerfehler-Regression: eine Definer-View, die niemand erreichen kann,
--    ist kein Loch. Die alte KC-Fassung meldete sie trotzdem.
create view public.probe_sicht as select * from public.probe_dicht;
do $$
declare v jsonb := db_monitor.security_audit();
begin
  assert jsonb_array_length(v -> 'views_bypassing_rls') = 0,
    'View ohne Recht fuer anon darf kein Befund sein: ' || (v ->> 'views_bypassing_rls');
end $$;

-- 5. Mit Recht wird dieselbe View zum Befund
grant select on public.probe_sicht to anon;
do $$
declare v jsonb := db_monitor.security_audit();
begin
  assert v -> 'views_bypassing_rls' @> '["probe_sicht (View mit Eigentümerrechten)"]'::jsonb,
    'Erreichbare Definer-View wurde nicht gemeldet: ' || (v ->> 'views_bypassing_rls');
end $$;

-- 6. security_invoker-View umgeht RLS nicht und darf nicht gemeldet werden
create view public.probe_sicht_neu with (security_invoker=true) as select * from public.probe_dicht;
grant select on public.probe_sicht_neu to anon;
do $$
declare v jsonb := db_monitor.security_audit();
begin
  assert not (v -> 'views_bypassing_rls' @> '["probe_sicht_neu (View mit Eigentümerrechten)"]'::jsonb),
    'security_invoker-View faelschlich gemeldet';
end $$;

-- 7. Kapazitaet: Normalbetrieb ist kein Rueckstand
create table public.probe_last (id bigserial primary key, txt text);
insert into public.probe_last (txt) select 'x' from generate_series(1, 500);
delete from public.probe_last where id % 3 = 0;
analyze public.probe_last;
do $$
declare v jsonb := db_monitor.capacity();
begin
  assert not (v -> 'vacuum_backlog' @> '[{"table":"probe_last"}]'::jsonb),
    'Normalbetrieb wurde als Vacuum-Rueckstand gemeldet';
  assert (v ->> 'database_bytes')::bigint > 0, 'Datenbankgroesse fehlt';
  assert v -> 'connections' ->> 'used' is not null, 'Verbindungszahl fehlt';
end $$;

-- 8. Leerraum wird als Anteil und nicht ganzzahlig gerechnet
--    (ganzzahlige Division ergaebe 0 und damit 100 % frei fuer jede Tabelle)
do $$
declare v jsonb;
begin
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v
  from jsonb_array_elements(db_monitor.capacity() -> 'bloat') x
  where (x ->> 'free_percent')::numeric >= 99;
  assert v = '[]'::jsonb, 'Leerraum wurde ganzzahlig gerechnet: ' || v::text;
end $$;

-- 9. Niemand ausser dem Dienst darf das Paket aufrufen
do $$
declare offen text[];
begin
  select coalesce(array_agg(p.proname), '{}') into offen
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'db_monitor'
    and (has_function_privilege('anon', p.oid, 'execute')
      or has_function_privilege('public', p.oid, 'execute'));
  assert offen = '{}', 'Paketfunktion fuer anon/public aufrufbar: ' || array_to_string(offen, ', ');
end $$;

-- 11. Der Hinweis-Zweig muss laufen, nicht nur uebersetzen.
--     Gefunden im Betrieb: 'hinweise || text' ohne ::text bricht zur Laufzeit ab,
--     weil PostgreSQL den Text fuer eine Array-Angabe haelt. Lokal fiel es nicht
--     auf, weil keine Testtabelle gross genug fuer den Leerraum-Zweig war.
create table public.probe_leerraum (id bigserial primary key, fuellung text);
insert into public.probe_leerraum (fuellung)
  select repeat('x', 400) from generate_series(1, 40000);
delete from public.probe_leerraum where id % 2 = 0;
analyze public.probe_leerraum;
do $$
declare v jsonb := db_monitor.capacity();
begin
  assert v -> 'bloat' @> '[{"table":"probe_leerraum"}]'::jsonb,
    'Leerraum-Zweig wurde nicht ausgeloest, der Test prueft also nichts: ' || (v ->> 'bloat');
end $$;
do $$
declare v jsonb := db_monitor.report();
begin
  assert v ->> 'notes' like '%Leerraum im normalen Rahmen%',
    'Der Hinweis zum Leerraum fehlt: ' || (v ->> 'notes');
end $$;

-- 10. Erneutes Einspielen aendert nichts und bricht nicht ab
\i share/db-monitor/install.sql
do $$ begin
  assert db_monitor.report() ->> 'status' is not null, 'Bericht nach zweitem Einspielen leer';
end $$;

\echo 'db-monitor: alle Annahmen erfuellt'
