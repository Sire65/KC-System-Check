-- "KC Dienstplan meldet 3 Fehler" - wann?
--
-- Anlass: am 2026-09-06 stand die Programm-Kachel gelb, weil ein Lebenszeichen
-- error_count 3 trug. Der Satz liest sich als Gegenwart. Tatsaechlich stammte
-- er von 05:24 aus einer Browser-Sitzung, die sechs Stunden vorher aufgehoert
-- hatte zu senden: kicc_program_heartbeats haelt eine Zeile je Sitzung
-- (program_id + instance_id) und wird fortgeschrieben, die Kachel nimmt je
-- Programm die juengste.
--
-- Ein selbst gemeldeter Zaehler gilt fuer den Zeitpunkt seiner Meldung, nicht
-- fuer jetzt. Das Alter wurde bereits berechnet (alter_minuten) und nur bei
-- ueberfaellig mitgegeben - bei meldet_stoerung fehlte es. Ein Feld mehr,
-- keine neue Abfrage.
--
-- Was der Zaehler zaehlt, weiss uebrigens nur das Programm: die aeltere
-- Anbindung des Dienstplans zaehlt auch fehlgeschlagene Sendeversuche des
-- Lebenszeichens selbst mit, nicht nur Programmfehler. Das tragbare Paket in
-- share/heartbeat ueberlaesst die Zahl vollstaendig dem Programm.

create or replace function public.kc_system_check_programs()
returns jsonb
language sql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  with letzte as (
    select distinct on (program_id)
           program_id, received_at, status, version, error_count, queue_depth
    from public.kicc_program_heartbeats
    order by program_id, received_at desc
  ), anwendungen as (
    select r.app_id, r.name, r.category, r.heartbeat_program_id, r.heartbeat_expected,
           coalesce(r.heartbeat_max_age_minutes, 1440) as fenster,
           l.received_at, l.status, l.version, l.error_count,
           case when l.received_at is null then null
                else round(extract(epoch from now() - l.received_at)/60)::int end as alter_minuten
    from public.kc_core_app_registry r
    left join letzte l on l.program_id = r.heartbeat_program_id
    where r.active
  ), fremde as (
    select l.program_id, l.received_at
    from letzte l
    where not exists (select 1 from public.kc_core_app_registry r
                      where r.heartbeat_program_id = l.program_id)
  )
  select jsonb_build_object(
    'checked_at', now(),
    'anwendungen_gesamt', (select count(*) from anwendungen),
    'angebunden', (select count(*) from anwendungen where heartbeat_program_id is not null),
    'ueberwacht', (select count(*) from anwendungen where heartbeat_expected),
    'gemeldet_24h', (select count(*) from anwendungen where received_at > now() - interval '24 hours'),
    'ohne_anbindung', coalesce((select jsonb_agg(name order by name) from anwendungen where heartbeat_program_id is null), '[]'::jsonb),
    'ueberfaellig', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'alter_minuten', alter_minuten, 'fenster', fenster) order by name)
                              from anwendungen
                              where heartbeat_expected
                                and (received_at is null or alter_minuten > fenster)), '[]'::jsonb),
    'meldet_stoerung', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'status', status, 'fehler', error_count, 'alter_minuten', alter_minuten) order by name)
                                 from anwendungen
                                 where received_at > now() - interval '24 hours'
                                   and coalesce(error_count,0) > 0), '[]'::jsonb),
    'zuletzt', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'alter_minuten', alter_minuten, 'status', status, 'version', version) order by received_at desc)
                         from anwendungen where received_at is not null), '[]'::jsonb),
    'nicht_registriert', coalesce((select jsonb_agg(program_id order by program_id) from fremde), '[]'::jsonb)
  );
$function$;

revoke all on function public.kc_system_check_programs() from public, anon, authenticated;
grant execute on function public.kc_system_check_programs() to service_role;
