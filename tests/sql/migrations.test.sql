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

\echo 'ALLE SQL-PRUEFUNGEN BESTANDEN'
