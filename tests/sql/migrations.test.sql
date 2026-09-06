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
\i supabase/migrations/202609060003_kc_alarm_quality.sql
\i supabase/migrations/202609060004_kc_security_audit_calibration.sql
create table if not exists public.kc_core_user_links(user_id uuid, core_role text, active boolean default true);
alter table public.kc_core_user_links enable row level security;
revoke all on table public.kc_core_user_links from anon, authenticated;
\i supabase/migrations/202609060006_kc_automation_und_rollen.sql
\i supabase/migrations/202609060007_kc_alarm_entwarnung.sql

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
  -- Die erste Messung eines noch unbekannten Signals gilt sofort.
  v := public.kc_system_check_alarm_apply('[{"id":"kc_core","name":"KC Core","status":"critical"}]'::jsonb);
  assert jsonb_array_length(v -> 'notify') = 1, 'Der erste bekannte Zustand muss gemeldet werden';
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

\echo 'ALLE SQL-PRUEFUNGEN BESTANDEN'
