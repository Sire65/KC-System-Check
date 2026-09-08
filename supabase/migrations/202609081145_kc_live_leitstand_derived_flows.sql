-- LIVE-Leitstand: Die Datenflussansicht darf nicht leer bleiben, obwohl die
-- beteiligten Systeme bereits echte Betriebsdaten liefern. Neben expliziten
-- Flow-Ereignissen werden deshalb vorhandene Heartbeats, der letzte
-- Spiegelungslauf und die authentifizierte Backup-Telemetrie als abgeleitete
-- Leitflüsse in denselben read-only Schnappschuss aufgenommen.
-- Es werden keine erfundenen Erfolgsmeldungen gespeichert und keine neuen
-- Telemetriezeilen erzeugt.

create or replace function public.kc_system_leitstand_snapshot()
returns jsonb
language sql
set search_path to 'public'
as $function$
with hb as (
  select distinct on(program_id,instance_id)
    program_id,instance_id,version,build,status,measured_at,received_at,latency_ms,
    traffic_rx,traffic_tx,queue_depth,error_count,source_id,trust
  from public.kicc_program_heartbeats
  order by program_id,instance_id,measured_at desc
),
reported_flows as (
  select program_id::text,instance_id::text,source_id::text,target_id::text,flow_type::text,
         event_count::bigint,byte_count::bigint,status::text,measured_at,received_at
  from public.kicc_program_flow_events
  order by measured_at desc limit 40
),
heartbeat_flows as (
  select
    program_id::text,
    instance_id::text,
    program_id::text as source_id,
    'supabase'::text as target_id,
    'heartbeat_sync'::text as flow_type,
    greatest(coalesce(traffic_tx,0),1)::bigint as event_count,
    null::bigint as byte_count,
    status::text,
    measured_at,
    received_at
  from hb
  where measured_at >= now()-interval '10 minutes'
    and program_id ~* '(kc[-_]?dp|dienstplan|manager|kasse|markt|pos|money|butler)'
),
mirror_flow as (
  select
    'kc-mirror'::text as program_id,
    'server'::text as instance_id,
    'supabase'::text as source_id,
    'neon-mirror'::text as target_id,
    'replication'::text as flow_type,
    greatest(coalesce(source_rows,0),1)::bigint as event_count,
    null::bigint as byte_count,
    status::text,
    coalesce(finished_at,started_at) as measured_at,
    coalesce(finished_at,started_at) as received_at
  from public.kc_db_mirror_runs
  order by coalesce(finished_at,started_at) desc nulls last
  limit 1
),
pbv_flow as (
  select
    source_program::text as program_id,
    device_id::text as instance_id,
    'pc-backup'::text as source_id,
    case
      when lower(coalesce(storage_target,'')) ~ '(b2|backblaze)' then 'b2'
      when lower(coalesce(storage_target,'')) like '%neon%' then 'neon-vault'
      else null
    end::text as target_id,
    'backup_status'::text as flow_type,
    1::bigint as event_count,
    coalesce(last_backup_stored_bytes,last_backup_original_bytes,0)::bigint as byte_count,
    coalesce(nullif(b2_status,''),nullif(neon_status,''),nullif(last_backup_status,''),status)::text as status,
    measured_at,
    updated_at as received_at
  from public.kc_backup_machine_telemetry
  where lower(coalesce(storage_target,'')) ~ '(b2|backblaze|neon)'
  order by measured_at desc nulls last
  limit 1
),
flows as (
  select program_id,instance_id,source_id,target_id,flow_type,event_count,byte_count,status,measured_at,received_at
  from (
    select * from reported_flows
    union all
    select * from heartbeat_flows
    union all
    select * from mirror_flow
    union all
    select * from pbv_flow where target_id is not null
  ) f
  order by measured_at desc nulls last
  limit 40
),
sales as (
  select event_id,register_id,instance_id,event_type,amount_cents,payment_type,item_count,sync_state,queue_depth,occurred_at,received_at
  from public.kc_pos_live_events
  where occurred_at>=now()-interval '24 hours'
  order by occurred_at desc limit 50
),
comm as (
  select to_jsonb(x) row from (
    select * from public.kc_communication_health_snapshots order by created_at desc limit 1
  ) x
),
backup_machine as (
  select to_jsonb(x) row from (
    select machine_client_id,source_program,device_id,app_version,status,last_backup_at,last_backup_status,
           last_backup_original_bytes,last_backup_stored_bytes,last_integrity_at,integrity_result,
           last_restore_test_at,restore_result,storage_target,neon_status,b2_status,rpo_seconds,rto_seconds,
           storage_targets,measured_at,updated_at
    from public.kc_backup_machine_telemetry
    order by measured_at desc limit 1
  ) x
),
backup_kicc as (
  select to_jsonb(x) row from (
    select source_program,device_id,app_version,status,measured_at,last_backup_at,last_backup_status,
           last_backup_bytes,last_backup_files,backup_target,last_verify_at,last_verify_result,
           last_restore_test_at,last_restore_test_result,integrity_status,rpo_seconds,rto_seconds,
           storage_targets,updated_at
    from public.kicc_backup_telemetry
    order by measured_at desc limit 1
  ) x
)
select jsonb_build_object(
  'checked_at',now(),
  'heartbeats',coalesce((select jsonb_agg(to_jsonb(hb) order by measured_at desc) from hb),'[]'::jsonb),
  'flows',coalesce((select jsonb_agg(to_jsonb(flows) order by measured_at desc) from flows),'[]'::jsonb),
  'sales',coalesce((select jsonb_agg(to_jsonb(sales) order by occurred_at desc) from sales),'[]'::jsonb),
  'communication',coalesce((select row from comm limit 1),'{}'::jsonb),
  'backup',jsonb_build_object(
      'machine',coalesce((select row from backup_machine limit 1),'{}'::jsonb),
      'kicc',coalesce((select row from backup_kicc limit 1),'{}'::jsonb)
  ),
  'apps',coalesce((select jsonb_agg(jsonb_build_object('app_id',app_id,'name',name,'category',category,'active',active) order by app_id)
                   from public.kc_core_app_registry where active),'[]'::jsonb)
);
$function$;
