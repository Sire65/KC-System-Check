-- KC System Check: Alarmmails mit Messwerten und belastbare Lebenszeichenbewertung.
--
-- 1) Die Alarmfunktion uebergibt health, coverage und timestamp bereits an den
--    KC Communicator. Das bisherige generische E-Mail-Template zeigte aber nur
--    {{message}}. Ein eigenes Template macht die Werte jetzt sichtbar, ohne die
--    Push-Nachricht aufzublaehen.
--
-- 2) error_count im Heartbeat ist ein kumulativer Zaehler. Beim Dienstplan
--    zaehlt er unter anderem fehlgeschlagene Meldeversuche seit Sitzungsstart.
--    Ein ONLINE-Programm mit error_count > 0 ist daher nicht automatisch
--    aktuell gestoert. Der aktuelle Status entscheidet; der Zaehler bleibt in
--    den Rohdaten erhalten.

insert into public.kc_communication_templates
  (id, display_name, channel_variants, enabled, version, created_at, updated_at)
values
  (
    'kc_system_check_alert_v2',
    'KC System Check – Alarm mit Messwerten',
    jsonb_build_object(
      'push', jsonb_build_object(
        'title', '{{programName}}',
        'body', '{{message}}'
      ),
      'email', jsonb_build_object(
        'subject', '{{programName}} – {{eventName}}',
        'text', E'{{message}}\n\nMesswerte des Prüflaufs:\nGesamtgesundheit: {{health}} %\nPrüfabdeckung: {{coverage}} %\nPrüfzeitpunkt: {{timestamp}}\n\nDie Detailangaben oben stammen aus demselben Prüflauf.'
      )
    ),
    true,
    1,
    now(),
    now()
  )
on conflict (id) do update set
  display_name = excluded.display_name,
  channel_variants = excluded.channel_variants,
  enabled = true,
  version = greatest(public.kc_communication_templates.version, excluded.version),
  updated_at = now();

update public.kc_communication_event_rules
set template_id = 'kc_system_check_alert_v2',
    updated_at = now()
where source_program = 'kc-system-check'
  and event_key in ('system_error', 'system_warning', 'system_recovered');

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
           l.received_at, l.status, l.version, l.error_count, l.queue_depth,
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
                                   and (
                                     upper(coalesce(status,'')) in ('ERROR','CRITICAL','DEGRADED','WARNING','FAILED','FAIL','OFFLINE')
                                     or (
                                       coalesce(error_count,0) > 0
                                       and upper(coalesce(status,'')) not in ('ONLINE','OK','HEALTHY','RUNNING','IDLE')
                                     )
                                   )), '[]'::jsonb),
    'zuletzt', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'alter_minuten', alter_minuten, 'status', status, 'version', version, 'fehler_seit_start', error_count) order by received_at desc)
                         from anwendungen where received_at is not null), '[]'::jsonb),
    'nicht_registriert', coalesce((select jsonb_agg(program_id order by program_id) from fremde), '[]'::jsonb)
  );
$function$;

revoke all on function public.kc_system_check_programs() from public, anon, authenticated;
grant execute on function public.kc_system_check_programs() to service_role;
