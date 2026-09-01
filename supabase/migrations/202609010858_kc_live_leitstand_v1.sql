create table if not exists public.kc_pos_live_events (
  event_id text primary key,
  register_id text not null,
  instance_id text,
  event_type text not null check (event_type in ('sale','void','storno','sync','status')),
  amount_cents integer,
  payment_type text,
  item_count integer,
  sync_state text,
  queue_depth integer,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);
comment on table public.kc_pos_live_events is 'Sanitized technical live POS telemetry for KC Superadmin Leitstand; no customer data, no article details, no secrets.';
alter table public.kc_pos_live_events enable row level security;
revoke all on table public.kc_pos_live_events from anon, authenticated;
create index if not exists kc_pos_live_events_occurred_at_desc_idx on public.kc_pos_live_events (occurred_at desc);
create index if not exists kc_pos_live_events_register_occurred_idx on public.kc_pos_live_events (register_id, occurred_at desc);
create or replace function public.kc_system_leitstand_snapshot()
returns jsonb language sql security invoker set search_path=public as $$
with hb as (select distinct on(program_id,instance_id) program_id,instance_id,version,build,status,measured_at,received_at,latency_ms,traffic_rx,traffic_tx,queue_depth,error_count,source_id,trust from public.kicc_program_heartbeats order by program_id,instance_id,measured_at desc),
flows as (select program_id,instance_id,source_id,target_id,flow_type,event_count,byte_count,status,measured_at,received_at from public.kicc_program_flow_events order by measured_at desc limit 40),
sales as (select event_id,register_id,instance_id,event_type,amount_cents,payment_type,item_count,sync_state,queue_depth,occurred_at,received_at from public.kc_pos_live_events where occurred_at>=now()-interval '24 hours' order by occurred_at desc limit 50),
comm as (select to_jsonb(x) row from (select * from public.kc_communication_health_snapshots order by created_at desc limit 1)x)
select jsonb_build_object('checked_at',now(),'heartbeats',coalesce((select jsonb_agg(to_jsonb(hb) order by measured_at desc)from hb),'[]'::jsonb),'flows',coalesce((select jsonb_agg(to_jsonb(flows) order by measured_at desc)from flows),'[]'::jsonb),'sales',coalesce((select jsonb_agg(to_jsonb(sales) order by occurred_at desc)from sales),'[]'::jsonb),'communication',coalesce((select row from comm limit 1),'{}'::jsonb),'apps',coalesce((select jsonb_agg(jsonb_build_object('app_id',app_id,'name',name,'category',category,'active',active) order by app_id)from public.kc_core_app_registry where active),'[]'::jsonb));
$$;
revoke all on function public.kc_system_leitstand_snapshot() from public,anon,authenticated;
grant execute on function public.kc_system_leitstand_snapshot() to service_role;
