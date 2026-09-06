-- Lebenszeichen: die bestehende Registrierung wird erweitert, keine neue Liste.
--
-- Ausgangslage, nachgesehen statt vermutet:
--   kc_core_app_registry        13 aktive Anwendungen, IDs wie KC_MARKTKASSE
--   kicc_program_heartbeats      3 meldende Programme, IDs wie kc-dp2
--   KICC-Produktkatalog (JS)    18 Eintraege, wieder eigene IDs
-- Drei Listen, die nicht zusammenpassen. Eine vierte anzulegen waere der
-- gleiche Fehler noch einmal - deshalb bekommt die vorhandene Registrierung
-- die fehlenden drei Spalten.
--
-- Was ein Lebenszeichen hier BEDEUTET, und was nicht:
-- Die vorhandenen Lebenszeichen kommen aus dem Browser. Sie belegen "war um
-- 08:23 in Benutzung" - sie belegen NICHT, dass ein Dienst laeuft, und ihr
-- Ausbleiben belegt keinen Ausfall. Wer nachts niemanden an der Kasse hat,
-- hat keine Stoerung. Deshalb ist heartbeat_expected standardmaessig falsch:
-- ein Programm wird erst dann ueberwacht, wenn jemand entscheidet, dass es
-- sich in einem Zeitfenster melden MUSS. Alles andere waere eine Ampel, die
-- zwoelfmal ohne Grund rot steht.

alter table public.kc_core_app_registry
  add column if not exists heartbeat_program_id text,
  add column if not exists heartbeat_expected boolean not null default false,
  add column if not exists heartbeat_max_age_minutes integer;

comment on column public.kc_core_app_registry.heartbeat_program_id is
  'Die programId, unter der diese Anwendung Lebenszeichen sendet. Leer = noch nicht angebunden.';
comment on column public.kc_core_app_registry.heartbeat_expected is
  'Erst wenn das wahr ist, gilt ein ausbleibendes Lebenszeichen als Befund. Vorher ist es eine Bestandsangabe.';
comment on column public.kc_core_app_registry.heartbeat_max_age_minutes is
  'Innerhalb dieser Zeit muss ein Lebenszeichen eintreffen, wenn heartbeat_expected wahr ist.';

-- Nur was nachweisbar ist: kc-dp2 meldet sich tatsaechlich. Alle uebrigen
-- Zuordnungen waeren geraten, und eine geratene Zuordnung ueberwacht das
-- falsche Programm.
update public.kc_core_app_registry
   set heartbeat_program_id = 'kc-dp2'
 where app_id = 'KC_DP' and heartbeat_program_id is null;

-- Der Zustand aller Anwendungen in einem Aufruf. Liefert bewusst auch die
-- nicht angebundenen mit - sie sind der eigentliche Befund.
create or replace function public.kc_system_check_programs()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
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
    -- Meldet sich etwas, das gar nicht in der Registrierung steht? Das ist
    -- kein Fehler, aber es gehoert gesehen.
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
    -- Nur selbst gemeldete Fehler zaehlen. DEGRADED setzen die Melder, sobald
    -- das Fenster in den Hintergrund geht - das ist Normalbetrieb und waere
    -- als Stoerung gewertet ein Fehlalarm bei jedem Tabwechsel.
    'meldet_stoerung', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'status', status, 'fehler', error_count) order by name)
                                 from anwendungen
                                 where received_at > now() - interval '24 hours'
                                   and coalesce(error_count,0) > 0), '[]'::jsonb),
    'zuletzt', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'alter_minuten', alter_minuten, 'status', status, 'version', version) order by received_at desc)
                         from anwendungen where received_at is not null), '[]'::jsonb),
    'nicht_registriert', coalesce((select jsonb_agg(program_id order by program_id) from fremde), '[]'::jsonb)
  );
$$;

revoke all on function public.kc_system_check_programs() from public, anon, authenticated;
grant execute on function public.kc_system_check_programs() to service_role;
