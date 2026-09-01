create or replace function public.kc_system_leitstand_snapshot()
returns jsonb language sql security invoker set search_path=public as $$
with hb as (
  select distinct on(program_id,instance_id)
    program_id,instance_id,version,build,status,measured_at,received_at,latency_ms,
    traffic_rx,traffic_tx,queue_depth,error_count,source_id,trust
  from public.kicc_program_heartbeats
  order by program_id,instance_id,measured_at desc
),
flows as (
  select program_id,instance_id,source_id,target_id,flow_type,event_count,byte_count,status,measured_at,received_at
  from public.kicc_program_flow_events
  order by measured_at desc limit 40
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
           measured_at,updated_at
    from public.kc_backup_machine_telemetry
    order by measured_at desc limit 1
  ) x
),
backup_kicc as (
  select to_jsonb(x) row from (
    select source_program,device_id,app_version,status,measured_at,last_backup_at,last_backup_status,
           last_backup_bytes,last_backup_files,backup_target,last_verify_at,last_verify_result,
           last_restore_test_at,last_restore_test_result,integrity_status,rpo_seconds,rto_seconds,updated_at
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
$$;
revoke all on function public.kc_system_leitstand_snapshot() from public,anon,authenticated;
grant execute on function public.kc_system_leitstand_snapshot() to service_role;
