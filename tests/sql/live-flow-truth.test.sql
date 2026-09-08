\set ON_ERROR_STOP on
\set QUIET on

-- Minimale, eigenstaendige Umgebung fuer die Datenfluss-Wahrheitspruefung.
create table public.kicc_program_heartbeats(
  program_id text, instance_id text, version text, build text, status text,
  measured_at timestamptz, received_at timestamptz, latency_ms int,
  traffic_rx bigint, traffic_tx bigint, queue_depth int, error_count int,
  source_id text, trust text);
create table public.kicc_program_flow_events(
  program_id text, instance_id text, source_id text, target_id text, flow_type text,
  event_count bigint, byte_count bigint, status text, measured_at timestamptz, received_at timestamptz);
create table public.kc_db_mirror_runs(
  status text, started_at timestamptz, finished_at timestamptz,
  source_rows bigint, target_rows bigint, replication_lag_sec numeric, mismatch_count int);
create table public.kc_backup_machine_telemetry(
  machine_client_id text,source_program text,device_id text,app_version text,status text,
  last_backup_at timestamptz,last_backup_status text,last_backup_original_bytes bigint,last_backup_stored_bytes bigint,
  last_integrity_at timestamptz,integrity_result text,last_restore_test_at timestamptz,restore_result text,
  storage_target text,neon_status text,b2_status text,rpo_seconds int,rto_seconds int,storage_targets jsonb,
  measured_at timestamptz,updated_at timestamptz);
create table public.kicc_backup_telemetry(
  source_program text,device_id text,app_version text,status text,measured_at timestamptz,last_backup_at timestamptz,
  last_backup_status text,last_backup_bytes bigint,last_backup_files bigint,backup_target text,last_verify_at timestamptz,
  last_verify_result text,last_restore_test_at timestamptz,last_restore_test_result text,integrity_status text,
  rpo_seconds int,rto_seconds int,storage_targets jsonb,updated_at timestamptz);
create table public.kc_pos_live_events(
  event_id text,register_id text,instance_id text,event_type text,amount_cents bigint,payment_type text,
  item_count int,sync_state text,queue_depth int,occurred_at timestamptz,received_at timestamptz);
create table public.kc_communication_health_snapshots(created_at timestamptz default now(), payload jsonb);
create table public.kc_core_app_registry(app_id text,name text,category text,active boolean default true);

\i supabase/migrations/202609081820_kc_live_datenfluss_wahrheit.sql

-- Ein frischer Heartbeat mit grossem kumulativem Zaehler ist noch KEIN Flow.
insert into public.kicc_program_heartbeats(program_id,instance_id,status,measured_at,received_at,traffic_tx)
values ('kc-dp2','dp-test','ONLINE',now(),now(),999);

do $$
declare v jsonb := public.kc_system_leitstand_snapshot();
begin
  assert not exists (
    select 1 from jsonb_array_elements(v->'flows') f where f->>'flow_type'='heartbeat_sync'
  ), 'Heartbeat-Zaehler wurde faelschlich als Flow ausgegeben';
end $$;

-- Backup-Telemetrie ist jetzt frisch, der echte Backup-Lauf aber sechs Stunden alt.
-- Im Flow muss der echte Abschlusszeitpunkt stehen.
insert into public.kc_backup_machine_telemetry(
  machine_client_id,source_program,device_id,status,last_backup_at,last_backup_status,
  last_backup_stored_bytes,storage_target,b2_status,measured_at,updated_at)
values ('m1','pc-backup-vault','dev1','ONLINE',now()-interval '6 hours','SUCCESS',12345,'B2','SUCCESS',now(),now());

do $$
declare v jsonb := public.kc_system_leitstand_snapshot(); t timestamptz;
begin
  select (f->>'measured_at')::timestamptz into t
  from jsonb_array_elements(v->'flows') f where f->>'flow_type'='backup_completed' limit 1;
  assert t between now()-interval '6 hours 1 minute' and now()-interval '5 hours 59 minutes',
    'Backup-Flow verwendet nicht last_backup_at: ' || coalesce(t::text,'NULL');
end $$;

-- Ein echter Spiegelungslauf bleibt ein Flow mit seinem Abschlusszeitpunkt.
insert into public.kc_db_mirror_runs(status,started_at,finished_at,source_rows,target_rows,mismatch_count)
values ('ok',now()-interval '5 seconds',now(),42,42,0);

do $$
declare v jsonb := public.kc_system_leitstand_snapshot();
begin
  assert exists (
    select 1 from jsonb_array_elements(v->'flows') f
    where f->>'source_id'='supabase' and f->>'target_id'='neon-mirror'
      and f->>'flow_type'='replication'
  ), 'Echter Spiegelungslauf fehlt im Datenfluss';
end $$;
