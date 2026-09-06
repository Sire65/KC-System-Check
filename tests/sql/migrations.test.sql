-- Prueft die Serverfunktionen gegen eine echte PostgreSQL-Instanz.
-- Aufruf siehe tests/sql/run.sh. Bricht bei der ersten falschen Annahme ab.
\set ON_ERROR_STOP on
\set QUIET on

-- Supabase-Rollen nachbilden
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;

\i supabase/migrations/202609010510_kc_system_check_history_v1.sql
\i supabase/migrations/202609010516_kc_system_check_history_explicit_deny.sql
\i supabase/migrations/202609060001_kc_system_check_operators.sql
\i supabase/migrations/202609060002_kc_system_check_audit.sql
\i supabase/migrations/202609060010_kc_kapazitaet_kalibrierung.sql
\i supabase/migrations/202609060003_kc_alarm_quality.sql
\i supabase/migrations/202609060004_kc_security_audit_calibration.sql
create table if not exists public.kc_core_user_links(user_id uuid, core_role text, active boolean default true);
alter table public.kc_core_user_links enable row level security;
revoke all on table public.kc_core_user_links from anon, authenticated;
\i supabase/migrations/202609060006_kc_automation_und_rollen.sql
\i supabase/migrations/202609060007_kc_alarm_entwarnung.sql
\i supabase/migrations/202609060011_db_monitor_paket.sql
\i supabase/migrations/202609060012_kc_externe_zugaenge.sql
\i supabase/migrations/202609060013_db_monitor_paket_v2.sql
\i supabase/migrations/202609060014_kc_alarmregelwerk_gemeinsam.sql
\i supabase/migrations/202609060015_kc_erste_messung_meldet_nicht.sql
\i supabase/migrations/202609060016_kc_alarmregelwerk_sicherung.sql
-- Wie in der Produktion: Registrierung und Lebenszeichen liegen bereits vor
create table if not exists public.kc_core_app_registry(
  app_id text primary key, name text, category text, active boolean default true);
alter table public.kc_core_app_registry enable row level security;
revoke all on table public.kc_core_app_registry from anon, authenticated;
create table if not exists public.kicc_program_heartbeats(
  program_id text, instance_id text, version text, build text, status text,
  measured_at timestamptz, received_at timestamptz, latency_ms int,
  traffic_rx bigint, traffic_tx bigint, queue_depth int, error_count int,
  source_id text, trust text);
alter table public.kicc_program_heartbeats enable row level security;
revoke all on table public.kicc_program_heartbeats from anon, authenticated;
\i supabase/migrations/202609060017_kc_lebenszeichen_anbindung.sql

-- 1. Sauberer Zustand: keine Sicherheitsbefunde
do $$
declare v jsonb := public.kc_system_check_security_audit();
begin
  assert jsonb_array_length(v -> 'tables_without_rls') = 0, 'Unerwartete Tabelle ohne RLS: ' || (v ->> 'tables_without_rls');
  assert jsonb_array_length(v -> 'public_grants') = 0, 'Unerwartete Rechte fuer anon: ' || (v ->> 'public_grants');
end $$;

-- 2. Eine ungeschuetzte Tabelle wird gefunden
create table public.kc_audit_probe (id int);
grant select on public.kc_audit_probe to anon;
do $$
declare v jsonb := public.kc_system_check_security_audit();
begin
  assert v -> 'tables_without_rls' @> '["kc_audit_probe"]'::jsonb, 'Tabelle ohne RLS wurde nicht gemeldet';
  assert (v ->> 'public_grants') like '%kc_audit_probe%', 'Direktes Recht fuer anon wurde nicht gemeldet';
end $$;

-- 2b. Ein durch RLS gedecktes Recht ist KEIN Befund (Supabase-Standard)
create table public.kc_audit_gedeckt (id int);
alter table public.kc_audit_gedeckt enable row level security;
grant select, insert, update, delete on public.kc_audit_gedeckt to authenticated;
do $$
declare v jsonb := public.kc_system_check_security_audit();
begin
  assert (v ->> 'public_grants') not like '%kc_audit_gedeckt%',
    'Ein durch RLS gedecktes Recht darf kein Befund sein, sonst ist die Pruefung dauerhaft rot';
end $$;
drop table public.kc_audit_gedeckt;

-- 2c. Eine View mit Eigentuemerrechten umgeht RLS und ist ein Befund
create table public.kc_audit_basis (id int, geheim text);
alter table public.kc_audit_basis enable row level security;
create view public.kc_audit_definer_view as select * from public.kc_audit_basis;
grant select on public.kc_audit_definer_view to authenticated;
do $$
declare v jsonb := public.kc_system_check_security_audit();
begin
  assert (v ->> 'views_bypassing_rls') like '%kc_audit_definer_view%',
    'Eine View mit Eigentuemerrechten muss gemeldet werden';
end $$;
-- Mit security_invoker greift das RLS der Basistabelle: kein Befund mehr
alter view public.kc_audit_definer_view set (security_invoker = true);
do $$
declare v jsonb := public.kc_system_check_security_audit();
begin
  assert (v ->> 'views_bypassing_rls') not like '%kc_audit_definer_view%',
    'Mit security_invoker=true ist die View kein Befund mehr';
end $$;
drop view public.kc_audit_definer_view;
drop table public.kc_audit_basis;

-- 3. Eine uneingeschraenkte Policy wird gefunden
alter table public.kc_audit_probe enable row level security;
create policy kc_audit_probe_open on public.kc_audit_probe for select to anon using (true);
do $$
declare v jsonb := public.kc_system_check_security_audit();
begin
  assert (v ->> 'permissive_policies') like '%kc_audit_probe_open%', 'Offene Policy wurde nicht gemeldet';
end $$;
drop table public.kc_audit_probe;

-- 4. Kapazitaet liefert Verbindungen und Limit
do $$
declare v jsonb := public.kc_system_check_db_capacity();
begin
  assert ((v -> 'connections' ->> 'used')::int) > 0, 'Verbindungszahl fehlt';
  assert ((v -> 'connections' ->> 'limit_total')::int) > 0, 'Verbindungslimit fehlt';
  assert v ? 'largest_tables' and v ? 'sequences_near_limit' and v ? 'vacuum_backlog', 'Kapazitaetsfelder fehlen';
end $$;

-- 5. Entprellung: ein einzelner Ausreisser alarmiert nicht, der zweite schon
truncate public.kc_system_check_alarm_state;
do $$
declare v jsonb;
begin
  v := public.kc_system_check_alarm_apply('[{"id":"kc_core","name":"KC Core","status":"healthy"}]'::jsonb);
  assert jsonb_array_length(v -> 'alarms') = 0, 'Gesunder Erstzustand darf nicht alarmieren';
  v := public.kc_system_check_alarm_apply('[{"id":"kc_core","name":"KC Core","status":"critical"}]'::jsonb);
  assert jsonb_array_length(v -> 'alarms') = 0, 'Ein einzelner Ausreisser darf nicht alarmieren';
  v := public.kc_system_check_alarm_apply('[{"id":"kc_core","name":"KC Core","status":"critical"}]'::jsonb);
  assert jsonb_array_length(v -> 'alarms') = 1, 'Nach zwei Messungen muss der Alarm stehen';
  assert jsonb_array_length(v -> 'notify') = 1, 'Ein neuer Alarm muss gemeldet werden';
  v := public.kc_system_check_alarm_apply('[{"id":"kc_core","name":"KC Core","status":"critical"}]'::jsonb);
  assert jsonb_array_length(v -> 'notify') = 0, 'Ein bestehender Alarm darf nicht erneut gemeldet werden';
end $$;

-- 6. Entwarnung braucht mehr Bestaetigung als Alarm
do $$
declare v jsonb;
begin
  v := public.kc_system_check_alarm_apply('[{"id":"kc_core","status":"healthy"}]'::jsonb);
  assert jsonb_array_length(v -> 'alarms') = 1, 'Eine gute Messung darf den Alarm nicht loeschen';
  v := public.kc_system_check_alarm_apply('[{"id":"kc_core","status":"healthy"}]'::jsonb);
  v := public.kc_system_check_alarm_apply('[{"id":"kc_core","status":"healthy"}]'::jsonb);
  assert jsonb_array_length(v -> 'alarms') = 0, 'Nach drei guten Messungen muss entwarnt sein';
end $$;

-- 7. Folgealarme werden unterdrueckt
truncate public.kc_system_check_alarm_state;
do $$
declare v jsonb; policy jsonb := '{"dependencies":{"mirror":["kc_core"]}}'::jsonb;
  signals jsonb := '[{"id":"kc_core","status":"critical"},{"id":"mirror","status":"critical"}]'::jsonb;
begin
  v := public.kc_system_check_alarm_apply(signals, policy);
  v := public.kc_system_check_alarm_apply(signals, policy);
  assert jsonb_array_length(v -> 'alarms') = 1, 'Nur die Ursache darf alarmieren';
  assert v -> 'alarms' -> 0 ->> 'id' = 'kc_core', 'Die Ursache muss der Alarm sein';
  assert v -> 'suppressed' -> 0 ->> 'causedBy' = 'kc_core', 'Der Folgealarm muss der Ursache zugeordnet sein';
end $$;

-- 8. Wartungsfenster schaltet stumm
truncate public.kc_system_check_alarm_state;
do $$
declare v jsonb;
begin
  v := public.kc_system_check_alarm_apply('[{"id":"kc_core","status":"critical"}]'::jsonb);
  update public.kc_system_check_alarm_state set suppressed_until = now() + interval '1 hour' where signal_id = 'kc_core';
  v := public.kc_system_check_alarm_apply('[{"id":"kc_core","status":"critical"}]'::jsonb);
  assert jsonb_array_length(v -> 'alarms') = 0, 'Wartung muss stummschalten';
  assert v -> 'suppressed' -> 0 ->> 'reason' = 'wartung', 'Grund muss Wartung sein';
end $$;

-- 9. Totmannschalter
do $$
declare v jsonb;
begin
  v := public.kc_system_check_watchdog(1500);
  assert (v ->> 'ok')::boolean = false, 'Ohne Lauf darf der Watchdog nicht gruen sein';
  insert into public.kc_system_check_history (checked_at, overall_status, health) values (now(), 'healthy', 100);
  v := public.kc_system_check_watchdog(1500);
  assert (v ->> 'ok')::boolean = true, 'Mit frischem Lauf muss der Watchdog gruen sein';
  update public.kc_system_check_history set checked_at = now() - interval '3 days';
  v := public.kc_system_check_watchdog(1500);
  assert (v ->> 'ok')::boolean = false, 'Ein drei Tage alter Lauf muss den Watchdog ausloesen';
end $$;

-- 10. Zugangsliste ist fuer anon gesperrt
do $$
begin
  assert (select relrowsecurity from pg_class where relname = 'kc_system_check_operators'), 'RLS fehlt auf der Zugangsliste';
  assert not exists (
    select 1 from information_schema.role_table_grants
    where table_name = 'kc_system_check_operators' and grantee in ('anon','authenticated')
  ), 'anon darf keine Rechte auf der Zugangsliste haben';
end $$;

-- 10b. Entwarnung nur nach vorheriger Meldung
truncate public.kc_system_check_alarm_state;
do $$
declare v jsonb;
begin
  -- Ein Signal, das nie gemeldet wurde, erzeugt keine Entwarnung
  v := public.kc_system_check_alarm_apply('[{"id":"still","status":"healthy"}]'::jsonb);
  assert jsonb_array_length(v -> 'recovered') = 0, 'Ohne vorherige Meldung gibt es keine Entwarnung';

  -- Ein bestaetigter und gemeldeter Alarm muss entwarnt werden.
  -- Der erste Zustand eines unbekannten Signals gilt sofort, gemeldet wird er
  -- aber erst, wenn er bestaetigt ist. Bis 0.7.15 stand hier "muss gemeldet
  -- werden" - das hat am 2026-09-06 eine einzelne Messung der brandneuen
  -- Neon-Kachel als Alarm verschickt.
  v := public.kc_system_check_alarm_apply('[{"id":"kc_core","name":"KC Core","status":"critical"}]'::jsonb);
  assert jsonb_array_length(v -> 'notify') = 0, 'Die erste Messung meldet noch nicht';
  v := public.kc_system_check_alarm_apply('[{"id":"kc_core","name":"KC Core","status":"critical"}]'::jsonb);
  assert jsonb_array_length(v -> 'notify') = 1, 'Die zweite Messung bestaetigt und meldet';
  v := public.kc_system_check_alarm_apply('[{"id":"kc_core","name":"KC Core","status":"critical"}]'::jsonb);
  assert jsonb_array_length(v -> 'notify') = 0, 'Derselbe Alarm darf nicht erneut gemeldet werden';
  v := public.kc_system_check_alarm_apply('[{"id":"kc_core","status":"healthy"}]'::jsonb);
  assert jsonb_array_length(v -> 'recovered') = 0, 'Eine einzelne gute Messung entwarnt noch nicht';
  v := public.kc_system_check_alarm_apply('[{"id":"kc_core","status":"healthy"}]'::jsonb);
  v := public.kc_system_check_alarm_apply('[{"id":"kc_core","status":"healthy"}]'::jsonb);
  assert jsonb_array_length(v -> 'recovered') = 1, 'Nach bestaetigter Erholung muss entwarnt werden';

  -- Und nur einmal
  v := public.kc_system_check_alarm_apply('[{"id":"kc_core","status":"healthy"}]'::jsonb);
  assert jsonb_array_length(v -> 'recovered') = 0, 'Entwarnung darf sich nicht wiederholen';
end $$;

-- 11. Verdichtung bewahrt die Kennzahlen und loescht selbst nichts
create table if not exists public.kc_db_mirror_runs(
  id bigserial primary key, status text, started_at timestamptz, finished_at timestamptz,
  source_rows bigint, target_rows bigint, replication_lag_sec numeric, mismatch_count int);
-- wie in der Produktion: RLS aktiv, kein Client-Recht
alter table public.kc_db_mirror_runs enable row level security;
revoke all on table public.kc_db_mirror_runs from anon, authenticated;
\i supabase/migrations/202609060005_kc_mirror_runs_retention.sql
insert into public.kc_db_mirror_runs(status, started_at, replication_lag_sec, mismatch_count)
select case when n % 20 = 0 then 'error' else 'ok' end,
       now() - make_interval(days => d) + make_interval(mins => n),
       (n % 7)::numeric,
       case when n % 50 = 0 then 1 else 0 end
from generate_series(1,30) d, generate_series(1,100) n;
do $$
declare v jsonb; v_vorher bigint; v_nachher bigint;
begin
  select count(*) into v_vorher from public.kc_db_mirror_runs;
  v := public.kc_db_mirror_daily_rollup();
  select count(*) into v_nachher from public.kc_db_mirror_runs;
  assert v_vorher = v_nachher, 'Die Verdichtung darf keine einzige Zeile loeschen';
  assert (v ->> 'aggregated_days')::int = 30, 'Alle abgeschlossenen Tage muessen verdichtet sein';
  assert (select sum(runs) from public.kc_db_mirror_runs_daily) = 3000, 'Jeder Lauf muss gezaehlt sein';
  assert (select sum(non_ok) from public.kc_db_mirror_runs_daily) > 0, 'Auffaellige Laeufe duerfen nicht verlorengehen';
  assert (select sum(mismatches) from public.kc_db_mirror_runs_daily) > 0, 'Abweichungen duerfen nicht verlorengehen';

  -- Zweiter Aufruf darf nichts verdoppeln
  v := public.kc_db_mirror_daily_rollup();
  assert (select sum(runs) from public.kc_db_mirror_runs_daily) = 3000, 'Mehrfacher Aufruf darf nicht doppelt zaehlen';
end $$;

-- 12. Es darf keinen zweiten Aufraeumer geben
do $$
begin
  assert not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'kc_db_mirror_runs_retention'
  ), 'Ein konkurrierender Aufraeumer neben kc_internal.kc_db_mirror_retention_cleanup ist nicht erlaubt';
end $$;

-- 13. Rollen aus beiden Listen, Automatik-Kennung
do $$
begin
  insert into public.kc_core_user_links values ('11111111-1111-1111-1111-111111111111','admin',true);
  insert into public.kc_system_check_operators values ('22222222-2222-2222-2222-222222222222','technik',true,null,now());
  assert public.kc_system_check_operator_role('11111111-1111-1111-1111-111111111111') = 'superadmin',
    'Ein KC-Admin muss ohne zweiten Eintrag Superadmin sein';
  assert public.kc_system_check_operator_role('22222222-2222-2222-2222-222222222222') = 'technik',
    'Nur-System-Check-Zugang muss weiter funktionieren';
  assert public.kc_system_check_operator_role('33333333-3333-3333-3333-333333333333') is null,
    'Ein fremdes Konto darf keine Rolle bekommen';

  insert into public.kc_automation_credentials(name, token_sha256)
    values ('cron', encode(sha256(convert_to('ein-hinreichend-langes-testgeheimnis','UTF8')),'hex'));
  assert public.kc_automation_verify('cron','ein-hinreichend-langes-testgeheimnis'),
    'Gueltige Automatik-Kennung muss akzeptiert werden';
  assert not public.kc_automation_verify('cron','falsch-aber-ebenfalls-lang-genug--'),
    'Falsche Kennung muss abgelehnt werden';
  assert not public.kc_automation_verify('cron','kurz'), 'Zu kurze Kennung muss abgelehnt werden';
  assert (select last_used_at is not null from public.kc_automation_credentials where name='cron'),
    'Die Nutzung muss vermerkt werden';
  assert not exists (
    select 1 from information_schema.role_table_grants
    where table_name = 'kc_automation_credentials' and grantee in ('anon','authenticated')
  ), 'Die Kennungstabelle darf fuer anon kein Recht haben';
end $$;

-- 14. Anwesenheiten sind fuer Clients gesperrt, serverseitig weiter lesbar
create table if not exists public.kc_attendance_events(
  org_id text, event_id text primary key, person_id text, member_number text);
alter table public.kc_attendance_events enable row level security;
grant select, insert, update, delete on public.kc_attendance_events to authenticated;
grant all on public.kc_attendance_events to service_role;
drop policy if exists attendance_lesen on public.kc_attendance_events;
create policy attendance_lesen on public.kc_attendance_events for select to authenticated using (true);
drop policy if exists attendance_schreiben_dienst on public.kc_attendance_events;
create policy attendance_schreiben_dienst on public.kc_attendance_events for all to service_role using (true);
insert into public.kc_attendance_events values ('org1','e1','p1','m1') on conflict do nothing;

do $$
declare v jsonb := public.kc_system_check_security_audit();
begin
  assert (v ->> 'permissive_policies') like '%attendance_lesen%',
    'Die offene Lese-Policy muss vor der Migration gemeldet werden';
end $$;

\i supabase/migrations/202609060008_kc_attendance_nur_dienst.sql

do $$
declare v jsonb := public.kc_system_check_security_audit();
begin
  assert (v ->> 'permissive_policies') not like '%attendance_lesen%',
    'Nach der Migration darf die offene Lese-Policy nicht mehr existieren';
  assert not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'kc_attendance_events'
      and grantee in ('anon','authenticated')
  ), 'Clients duerfen kein Recht mehr auf den Anwesenheiten haben';
  assert (select count(*) from public.kc_attendance_events) = 1,
    'Serverseitig muessen die Daten unveraendert lesbar bleiben';
  assert exists (
    select 1 from pg_policies where schemaname='public'
      and tablename='kc_attendance_events' and policyname='attendance_schreiben_dienst'
  ), 'Die serverseitige Schreibregel muss erhalten bleiben';
end $$;

-- 15. Datenvertrag ebenfalls nur serverseitig, Sicherheitspruefung wird sauber
create table if not exists public.kc_core_data_contract(
  data_area text, app_id text, is_owner boolean, may_read boolean, may_write boolean);
alter table public.kc_core_data_contract enable row level security;
grant select on public.kc_core_data_contract to authenticated;
drop policy if exists vertrag_lesen on public.kc_core_data_contract;
create policy vertrag_lesen on public.kc_core_data_contract for select to authenticated using (true);
drop policy if exists vertrag_pflegen on public.kc_core_data_contract;
create policy vertrag_pflegen on public.kc_core_data_contract for all to service_role using (true);
insert into public.kc_core_data_contract values ('anwesenheit','kc-dp2',true,true,true);

do $$
declare v jsonb := public.kc_system_check_security_audit();
begin
  assert (v ->> 'permissive_policies') like '%vertrag_lesen%',
    'Die offene Lese-Policy muss vor der Migration gemeldet werden';
end $$;

\i supabase/migrations/202609060009_kc_data_contract_nur_dienst.sql

do $$
declare v jsonb := public.kc_system_check_security_audit();
begin
  assert (v ->> 'permissive_policies') not like '%vertrag_lesen%',
    'Nach der Migration darf die offene Lese-Policy nicht mehr existieren';
  assert not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'kc_core_data_contract'
      and grantee in ('anon','authenticated')
  ), 'Clients duerfen kein Recht mehr auf dem Datenvertrag haben';
  assert (select count(*) from public.kc_core_data_contract) = 1,
    'Serverseitig muss der Vertrag unveraendert lesbar bleiben';
  -- Und damit ist die gesamte Sicherheitslage befundfrei
  assert jsonb_array_length(v -> 'tables_without_rls') = 0
     and jsonb_array_length(v -> 'views_bypassing_rls') = 0
     and jsonb_array_length(v -> 'public_grants') = 0
     and jsonb_array_length(v -> 'permissive_policies') = 0,
    'Nach beiden Einschraenkungen darf kein Sicherheitsbefund mehr offen sein';
end $$;

-- 16. Kapazitaet: Normalbetrieb ist kein Rueckstand, echter Rueckstand schon
create table public.kc_kapazitaet_probe(id bigserial primary key, wert text);
alter table public.kc_kapazitaet_probe enable row level security;
revoke all on table public.kc_kapazitaet_probe from anon, authenticated;
alter table public.kc_kapazitaet_probe set (autovacuum_enabled = false);
insert into public.kc_kapazitaet_probe(wert)
  select md5(random()::text) || repeat('y', 200) from generate_series(1,60000);
create index kc_kapazitaet_probe_idx on public.kc_kapazitaet_probe(wert);
analyze public.kc_kapazitaet_probe;

do $$
declare v jsonb := public.kc_system_check_db_capacity();
begin
  assert jsonb_array_length(v -> 'vacuum_backlog') = 0,
    'Eine frisch gefuellte Tabelle ist kein Vacuum-Rueckstand';
  assert (v ->> 'bloat') not like '%kc_kapazitaet_probe%',
    'Ohne Aenderungen gibt es keinen Leerraum zu melden';
end $$;

-- Jede Zeile einmal aendern: alle alten Versionen werden tot
update public.kc_kapazitaet_probe set wert = wert;
analyze public.kc_kapazitaet_probe;

do $$
declare v jsonb := public.kc_system_check_db_capacity();
  r jsonb; b jsonb; i jsonb;
begin
  select x into r from jsonb_array_elements(v -> 'vacuum_backlog') x
   where x ->> 'table' = 'kc_kapazitaet_probe';
  assert r is not null, 'Ein echter Rueckstand muss gemeldet werden';
  assert (r ->> 'dead_tuples')::bigint > (r ->> 'trigger_at')::bigint,
    'Gemeldet wird nur, was ueber der Ausloeseschwelle liegt';

  select x into b from jsonb_array_elements(v -> 'bloat') x
   where x ->> 'table' = 'kc_kapazitaet_probe';
  assert b is not null, 'Der Leerraum muss gemeldet werden';
  assert (b ->> 'free_percent')::numeric between 30 and 99,
    format('Leerraum unplausibel: %s %% - Ganzzahldivision?', b ->> 'free_percent');

  select x into i from jsonb_array_elements(v -> 'unused_indexes') x
   where x ->> 'index' = 'kc_kapazitaet_probe_idx';
  assert i is not null, 'Ein grosser, nie benutzter Index muss gemeldet werden';
  assert (i ->> 'scans')::bigint < 50, 'Nur kaum benutzte Indexe werden gemeldet';
end $$;

drop table public.kc_kapazitaet_probe;

-- Externe Zugaenge: nur der Dienst kommt heran, und nur was aktiv ist
insert into public.kc_external_credentials (name, kind, endpoint, secret)
values ('probe_zugang', 'postgres_http', 'beispiel.example', 'geheim-123');
do $$
declare v jsonb := public.kc_external_credential('probe_zugang');
begin
  assert v ->> 'secret' = 'geheim-123', 'Der Zugang wird nicht zurueckgegeben';
  assert v ->> 'endpoint' = 'beispiel.example', 'Die Adresse fehlt';
  assert (select last_used_at is not null from public.kc_external_credentials where name='probe_zugang'),
    'Die Nutzung wird nicht vermerkt';
  assert public.kc_external_credential('gibt_es_nicht') is null,
    'Ein unbekannter Name muss leer bleiben, nicht raten';
end $$;

-- Abgeschaltet heisst abgeschaltet
update public.kc_external_credentials set active = false where name = 'probe_zugang';
do $$ begin
  assert public.kc_external_credential('probe_zugang') is null,
    'Ein abgeschalteter Zugang wird weiter herausgegeben';
end $$;

-- Weder anon noch authenticated duerfen die Tabelle oder die Funktion anfassen
do $$
declare offen text[];
begin
  select coalesce(array_agg(g.grantee || ':' || g.privilege_type), '{}') into offen
  from information_schema.role_table_grants g
  where g.table_name = 'kc_external_credentials' and g.grantee in ('anon','authenticated');
  assert offen = '{}', 'Rechte fuer Clientrollen auf kc_external_credentials: ' || array_to_string(offen, ', ');
  assert not has_function_privilege('anon', 'public.kc_external_credential(text)', 'execute'),
    'anon darf den Zugang abrufen';
  assert not has_function_privilege('authenticated', 'public.kc_external_credential(text)', 'execute'),
    'authenticated darf den Zugang abrufen';
  assert (select relrowsecurity from pg_class where oid = 'public.kc_external_credentials'::regclass),
    'RLS ist auf kc_external_credentials nicht aktiv';
end $$;

-- Die zweite Paketfassung ist eingespielt: sichtbare Meldungen mit Umlauten
do $$
declare v text := (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'db_monitor' and p.proname = 'report');
begin
  assert v like '%geprüften Client-Rollen%', 'Die Meldung steht noch mit ASCII-Umlauten in der Datenbank';
  assert v not like '%geprueften Client-Rollen%', 'Die alte Fassung ist noch aktiv';
end $$;

-- Das hinterlegte Regelwerk gilt, wenn der Aufrufer keins mitgibt.
-- kc_core faellt aus, die Spiegelung ebenfalls. Laut config/alarm-policy.json
-- haengt mirror an kc_core - es darf also EINE Meldung geben, nicht zwei.
-- Vor der Migration war dependencies serverseitig leer und es kamen zwei.
delete from public.kc_system_check_alarm_state;
do $$
declare v jsonb := public.kc_system_check_alarm_apply(
  '[{"id":"kc_core","name":"KC Core","status":"critical"},{"id":"mirror","name":"Spiegelung","status":"critical"}]'::jsonb);
begin
  assert v -> 'notify' = '[]'::jsonb, 'Die erste Messung meldet nichts: ' || (v ->> 'notify');
  assert v -> 'suppressed' @> '[{"id":"mirror","reason":"abhaengigkeit","causedBy":"kc_core"}]'::jsonb,
    'Die Abhaengigkeit aus dem hinterlegten Regelwerk greift nicht: ' || (v ->> 'suppressed');
end $$;

-- Ein mitgegebenes Regelwerk hat weiter Vorrang
do $$
declare v jsonb;
begin
  delete from public.kc_system_check_alarm_state;
  v := public.kc_system_check_alarm_apply(
    '[{"id":"kc_core","name":"KC Core","status":"critical"},{"id":"mirror","name":"Spiegelung","status":"critical"}]'::jsonb,
    '{"dependencies":{}}'::jsonb);
  v := public.kc_system_check_alarm_apply(
    '[{"id":"kc_core","name":"KC Core","status":"critical"},{"id":"mirror","name":"Spiegelung","status":"critical"}]'::jsonb,
    '{"dependencies":{}}'::jsonb);
  assert jsonb_array_length(v -> 'notify') = 2,
    'Ein ausdruecklich mitgegebenes Regelwerk muss Vorrang haben: ' || (v ->> 'notify');
end $$;

-- Entprellung: ein einzelner Aussetzer ist kein Alarm
delete from public.kc_system_check_alarm_state;
do $$
declare v jsonb;
begin
  v := public.kc_system_check_alarm_apply('[{"id":"probe","name":"Probe","status":"healthy"}]'::jsonb);
  v := public.kc_system_check_alarm_apply('[{"id":"probe","name":"Probe","status":"critical"}]'::jsonb);
  assert v -> 'notify' = '[]'::jsonb, 'Ein einzelner Ausschlag darf nicht melden: ' || (v ->> 'notify');
  v := public.kc_system_check_alarm_apply('[{"id":"probe","name":"Probe","status":"critical"}]'::jsonb);
  assert jsonb_array_length(v -> 'notify') = 1, 'Zweimal kritisch muss melden: ' || (v ->> 'notify');
end $$;

-- Ein brandneues Signal meldet nicht nach einer einzigen Messung.
-- Genau daran ist der erste scharfe Lauf am 2026-09-06 gescheitert: die neue
-- Neon-Kachel stand fuer eine Messung auf Vacuum-Rueckstand und meldete.
do $$
declare v jsonb;
begin
  delete from public.kc_system_check_alarm_state;
  v := public.kc_system_check_alarm_apply('[{"id":"neuprobe","name":"Neuprobe","status":"warning"}]'::jsonb);
  assert v -> 'notify' = '[]'::jsonb,
    'Ein neues Signal darf nach einer Messung nicht melden: ' || (v ->> 'notify');
  assert jsonb_array_length(v -> 'alarms') = 1, 'Der Zustand gilt trotzdem';
  -- Und wieder gruen, ohne dass je gemeldet wurde: keine Entwarnung
  v := public.kc_system_check_alarm_apply('[{"id":"neuprobe","name":"Neuprobe","status":"healthy"}]'::jsonb);
  v := public.kc_system_check_alarm_apply('[{"id":"neuprobe","name":"Neuprobe","status":"healthy"}]'::jsonb);
  v := public.kc_system_check_alarm_apply('[{"id":"neuprobe","name":"Neuprobe","status":"healthy"}]'::jsonb);
  assert v -> 'recovered' = '[]'::jsonb,
    'Ohne Meldung gibt es auch keine Entwarnung: ' || (v ->> 'recovered');
end $$;

-- Ein von Anfang an gestoertes System meldet - nur eine Messung spaeter
do $$
declare v jsonb;
begin
  delete from public.kc_system_check_alarm_state;
  v := public.kc_system_check_alarm_apply('[{"id":"kaputtprobe","name":"Kaputtprobe","status":"critical"}]'::jsonb);
  assert v -> 'notify' = '[]'::jsonb, 'erste Messung meldet nicht';
  v := public.kc_system_check_alarm_apply('[{"id":"kaputtprobe","name":"Kaputtprobe","status":"critical"}]'::jsonb);
  assert jsonb_array_length(v -> 'notify') = 1, 'zweite Messung meldet: ' || (v ->> 'notify');
  v := public.kc_system_check_alarm_apply('[{"id":"kaputtprobe","name":"Kaputtprobe","status":"critical"}]'::jsonb);
  assert v -> 'notify' = '[]'::jsonb, 'danach nicht bei jeder weiteren Messung';
end $$;

-- Wiedervorlage nur fuer die Zustaende aus renotifyStatuses
do $$
declare v jsonb;
begin
  delete from public.kc_system_check_alarm_state;
  -- Eine offene Warnung, vor zwei Stunden gemeldet
  insert into public.kc_system_check_alarm_state (signal_id, confirmed, since, last_notified_at)
  values ('warnprobe', 'warning', now() - interval '3 hours', now() - interval '2 hours');
  v := public.kc_system_check_alarm_apply('[{"id":"warnprobe","name":"Warnprobe","status":"warning"}]'::jsonb);
  assert v -> 'notify' = '[]'::jsonb,
    'Eine offene Warnung darf nicht stuendlich wiederholt werden: ' || (v ->> 'notify');
  assert jsonb_array_length(v -> 'alarms') = 1, 'Offen bleibt sie trotzdem';
  -- Dasselbe kritisch: hier ist die Wiedervorlage gewollt
  insert into public.kc_system_check_alarm_state (signal_id, confirmed, since, last_notified_at)
  values ('rotprobe', 'critical', now() - interval '3 hours', now() - interval '2 hours');
  v := public.kc_system_check_alarm_apply('[{"id":"rotprobe","name":"Rotprobe","status":"critical"}]'::jsonb);
  assert jsonb_array_length(v -> 'notify') = 1,
    'Eine offene Stoerung muss wiedervorgelegt werden: ' || (v ->> 'notify');
end $$;

-- Entwarnung nur, wenn vorher alarmiert wurde
do $$
declare v jsonb;
begin
  delete from public.kc_system_check_alarm_state;
  -- Fall A: nie gemeldet -> keine Entwarnung
  insert into public.kc_system_check_alarm_state (signal_id, confirmed, since, last_notified_at)
  values ('stillprobe', 'warning', now(), null);
  for i in 1..3 loop
    v := public.kc_system_check_alarm_apply('[{"id":"stillprobe","name":"Stillprobe","status":"healthy"}]'::jsonb);
  end loop;
  assert v -> 'recovered' = '[]'::jsonb,
    'Entwarnung ohne vorherigen Alarm: ' || (v ->> 'recovered');
  -- Fall B: gemeldet -> Entwarnung
  insert into public.kc_system_check_alarm_state (signal_id, confirmed, since, last_notified_at)
  values ('lautprobe', 'critical', now(), now());
  for i in 1..3 loop
    v := public.kc_system_check_alarm_apply('[{"id":"lautprobe","name":"Lautprobe","status":"healthy"}]'::jsonb);
  end loop;
  assert v -> 'recovered' @> '[{"id":"lautprobe"}]'::jsonb,
    'Nach einem gemeldeten Alarm muss die Entwarnung kommen: ' || (v ->> 'recovered');
  assert (select last_notified_at is null from public.kc_system_check_alarm_state where signal_id='lautprobe'),
    'Nach der Entwarnung muss der Meldevermerk zurueckgesetzt sein';
end $$;

-- Wartungsfenster schlaegt alles
do $$
declare v jsonb;
begin
  delete from public.kc_system_check_alarm_state;
  insert into public.kc_system_check_alarm_state (signal_id, confirmed, since, suppressed_until)
  values ('wartungsprobe', 'critical', now(), now() + interval '1 hour');
  v := public.kc_system_check_alarm_apply('[{"id":"wartungsprobe","name":"Wartungsprobe","status":"critical"}]'::jsonb);
  assert v -> 'notify' = '[]'::jsonb, 'Im Wartungsfenster wird nicht gemeldet';
  assert v -> 'suppressed' @> '[{"id":"wartungsprobe","reason":"wartung"}]'::jsonb,
    'Die Unterdrueckung muss sichtbar sein, nicht stillschweigend';
end $$;

delete from public.kc_system_check_alarm_state;

-- Lebenszeichen: die Registrierung wird erweitert, keine neue Liste angelegt
do $$ begin
  assert (select count(*) from information_schema.columns
          where table_schema='public' and table_name='kc_core_app_registry'
            and column_name in ('heartbeat_program_id','heartbeat_expected','heartbeat_max_age_minutes')) = 3,
    'Die Registrierung hat die Lebenszeichen-Spalten nicht bekommen';
  assert not exists (select 1 from information_schema.tables
                     where table_schema='public' and table_name like '%program_watch%'),
    'Es darf keine zweite Programmliste geben';
end $$;

insert into public.kc_core_app_registry (app_id, name, category, active) values
  ('PROBE_STUMM','Probe Stumm','test',true),
  ('PROBE_ANGEBUNDEN','Probe Angebunden','test',true),
  ('PROBE_SCHARF','Probe Scharf','test',true)
on conflict (app_id) do nothing;

update public.kc_core_app_registry set heartbeat_program_id='probe-angebunden' where app_id='PROBE_ANGEBUNDEN';
update public.kc_core_app_registry set heartbeat_program_id='probe-scharf', heartbeat_expected=true,
       heartbeat_max_age_minutes=60 where app_id='PROBE_SCHARF';

-- Ohne Lebenszeichen: das scharfgestellte Programm ist ueberfaellig, das nur
-- angebundene nicht - und das stumme taucht als "ohne Anbindung" auf.
do $$
declare v jsonb := public.kc_system_check_programs();
begin
  assert v -> 'ueberfaellig' @> '[{"name":"Probe Scharf"}]'::jsonb,
    'Ein scharfgestelltes Programm ohne Lebenszeichen muss ueberfaellig sein: ' || (v ->> 'ueberfaellig');
  assert not (v -> 'ueberfaellig' @> '[{"name":"Probe Angebunden"}]'::jsonb),
    'Nur angebunden heisst nicht ueberwacht - ein Ausbleiben ist dort kein Befund';
  assert v -> 'ohne_anbindung' @> '["Probe Stumm"]'::jsonb,
    'Das nicht angebundene Programm fehlt in der Aufstellung';
end $$;

-- Mit frischem Lebenszeichen ist nichts mehr offen
insert into public.kicc_program_heartbeats (program_id, status, version, received_at, measured_at, error_count)
values ('probe-scharf','ONLINE','1.0.0', now(), now(), 0);
do $$
declare v jsonb := public.kc_system_check_programs();
begin
  assert v -> 'ueberfaellig' = '[]'::jsonb, 'Ein frisches Lebenszeichen muss zaehlen: ' || (v ->> 'ueberfaellig');
  assert v -> 'meldet_stoerung' = '[]'::jsonb, 'ONLINE ohne Fehler ist keine Stoerung';
end $$;

-- Ein Fenster im Hintergrund meldet DEGRADED. Das ist Normalbetrieb und darf
-- kein Befund sein - sonst meldet jeder Tabwechsel eine Stoerung.
insert into public.kicc_program_heartbeats (program_id, status, version, received_at, measured_at, error_count)
values ('probe-scharf','DEGRADED','1.0.0', now(), now(), 0);
do $$
declare v jsonb := public.kc_system_check_programs();
begin
  assert v -> 'meldet_stoerung' = '[]'::jsonb,
    'DEGRADED heisst Hintergrund, nicht Stoerung: ' || (v ->> 'meldet_stoerung');
end $$;

-- Meldet das Programm selbst Fehler, ist das ein Befund
insert into public.kicc_program_heartbeats (program_id, status, version, received_at, measured_at, error_count)
values ('probe-scharf','ONLINE','1.0.0', now(), now(), 3);
do $$
declare v jsonb := public.kc_system_check_programs();
begin
  assert v -> 'meldet_stoerung' @> '[{"name":"Probe Scharf","fehler":3}]'::jsonb,
    'Ein selbst gemeldeter Fehler muss durchkommen: ' || (v ->> 'meldet_stoerung');
end $$;

-- Ein Melder ohne Registrierung geht nicht verloren
insert into public.kicc_program_heartbeats (program_id, status, received_at, measured_at)
values ('probe-unbekannt','ONLINE', now(), now());
do $$
declare v jsonb := public.kc_system_check_programs();
begin
  assert v -> 'nicht_registriert' @> '["probe-unbekannt"]'::jsonb,
    'Was sich meldet, ohne registriert zu sein, gehoert gesehen: ' || (v ->> 'nicht_registriert');
end $$;

-- Weder anon noch authenticated duerfen die Aufstellung abrufen
do $$ begin
  assert not has_function_privilege('anon', 'public.kc_system_check_programs()', 'execute'),
    'anon darf die Programmaufstellung abrufen';
  assert not has_function_privilege('authenticated', 'public.kc_system_check_programs()', 'execute'),
    'authenticated darf die Programmaufstellung abrufen';
end $$;

delete from public.kicc_program_heartbeats where program_id like 'probe-%';
delete from public.kc_core_app_registry where app_id like 'PROBE_%';

\echo 'ALLE SQL-PRUEFUNGEN BESTANDEN'
