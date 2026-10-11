-- KC Check 0.10.5 – KC-CHECK-DIREKTE-LEITUNG (Wunsch Hansi 11.10.2026: „Datenverkehr läuft immer mit Verzögerung“)
-- Der Leitstand hatte schon einen Realtime-Empfänger (Kanal kc-datenfluss, Ereignis „fluss“), aber kein Server sendete.
-- Jetzt melden Datenbank-Auslöser sofort:
--   • kicc_program_flow_events (neu)      → „fluss“ mit Kante von → nach (Format wie in js/leitstand.js / js/flow-live-v4.js erwartet)
--   • kicc_program_heartbeats (geändert)  → „auffrischen“, wenn Status, Fehlerzahl oder Datenverkehr sich ändern (höchstens 1× je 10 s)
-- Nur Signale ohne Kassen- oder Personendaten (öffentlicher Kanal). Sparbremse gemeinsam mit der Club-App (kc_club_rt_zaehler):
-- ab 1,4 Mio. Signalen im Monat schweigt der KC Check (dann läuft er wie bisher über die 30-Sekunden-Abfrage).
create table if not exists public.kc_check_rt_takt (
  id smallint primary key default 1 check (id = 1),
  zuletzt timestamptz not null default 'epoch'
);
alter table public.kc_check_rt_takt enable row level security;
revoke all on public.kc_check_rt_takt from anon, authenticated;
insert into public.kc_check_rt_takt (id) values (1) on conflict do nothing;

create or replace function public.kc_check_rt_senden(p_event text, p_payload jsonb)
returns void language plpgsql security definer set search_path to '' as $$
declare v_monat text := to_char(now() at time zone 'Europe/Berlin', 'YYYY-MM'); v_n bigint;
begin
  begin
    select anzahl into v_n from public.kc_club_rt_zaehler where monat = v_monat;
    if coalesce(v_n, 0) >= 1400000 then return; end if;
    insert into public.kc_club_rt_zaehler (monat, anzahl) values (v_monat, 1)
      on conflict (monat) do update set anzahl = public.kc_club_rt_zaehler.anzahl + 1, geaendert_am = now();
    perform realtime.send(p_payload, p_event, 'kc-datenfluss', false);
  exception when others then null; -- ein Signal darf nie das Schreiben der Messwerte verhindern
  end;
end $$;
revoke all on function public.kc_check_rt_senden(text, jsonb) from public, anon, authenticated;

create or replace function public.kc_check_rt_fluss()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.flow_type is distinct from 'heartbeat_sync' and new.source_id is not null and new.target_id is not null then
    perform public.kc_check_rt_senden('fluss', jsonb_build_object(
      'von', new.source_id, 'zeit', coalesce(new.measured_at, now()), 'status', new.status,
      'kanten', jsonb_build_array(jsonb_build_object('nach', new.target_id, 'req', coalesce(new.event_count, 1), 'bytes', coalesce(new.byte_count, 0),
        'fehler', case when lower(coalesce(new.status, '')) in ('error', 'failed', 'critical', 'fehler') then 1 else 0 end))));
  end if;
  return null;
end $$;
revoke all on function public.kc_check_rt_fluss() from public, anon, authenticated;

create or replace function public.kc_check_rt_heartbeat()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_ok boolean;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and coalesce(new.error_count, 0) = coalesce(old.error_count, 0)
     and coalesce(new.traffic_tx, 0) = coalesce(old.traffic_tx, 0) and coalesce(new.traffic_rx, 0) = coalesce(old.traffic_rx, 0) then return null; end if;
  -- höchstens ein „auffrischen“ je 10 Sekunden für alle Programme zusammen (der Leitstand holt dann ohnehin alles neu)
  update public.kc_check_rt_takt set zuletzt = now() where id = 1 and zuletzt < now() - interval '10 seconds' returning true into v_ok;
  if v_ok then perform public.kc_check_rt_senden('auffrischen', jsonb_build_object('art', 'heartbeat', 'programm', new.program_id, 'status', new.status)); end if;
  return null;
exception when others then return null;
end $$;
revoke all on function public.kc_check_rt_heartbeat() from public, anon, authenticated;

drop trigger if exists kc_check_rt_fluss on public.kicc_program_flow_events;
create trigger kc_check_rt_fluss after insert on public.kicc_program_flow_events for each row execute function public.kc_check_rt_fluss();
drop trigger if exists kc_check_rt_heartbeat on public.kicc_program_heartbeats;
create trigger kc_check_rt_heartbeat after insert or update on public.kicc_program_heartbeats for each row execute function public.kc_check_rt_heartbeat();

insert into public.kc_db_mirror_table_rules(table_name, area, sensitivity, realtime_allowed, mirror_enabled, backup_enabled, note, updated_at)
values ('kc_check_rt_takt', 'KC Check', 'normal', false, false, false, 'KC-CHECK-DIREKTE-LEITUNG: Takt der Realtime-Signale, nicht spiegeln', now())
on conflict (table_name) do nothing;
