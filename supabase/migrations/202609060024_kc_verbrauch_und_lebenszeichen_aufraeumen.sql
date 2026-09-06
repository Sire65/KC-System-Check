-- Zwei Zahlen, die kleiner waren als die Wirklichkeit.
--
-- 1. Der Verbrauch war bei 40 gedeckelt. Die Kachel rechnete aus der
--    Verlaufsliste, und die holt sich seit jeher nur die letzten 40 Laeufe.
--    Tatsaechlich waren es in 31 Tagen 464. Der Free-Tier-Anteil war damit um
--    das Elffache zu niedrig - also genau in der Richtung, in der eine
--    Verbrauchsanzeige nicht irren darf.
--
--    Neu: kc_system_check_usage() zaehlt in der Datenbank statt im Browser.
--    Nebenbei kommt heraus, wie viele Laeufe nicht gruen waren - die Zahl
--    braucht der Verlauf, um nicht "keine Fehler" zu behaupten, waehrend 46
--    auffaellige Laeufe gespeichert sind.
--
-- 2. kicc_program_heartbeats haelt eine Zeile je Browser-Sitzung, fuer immer.
--    Die LIVE-Liste wurde dadurch zu einer Halde: 27 Zeilen, davon zwei aktiv,
--    zwei aelter als eine Woche. Aufraeumen mit einer Schutzregel - die
--    juengste Sitzung eines Programms bleibt IMMER stehen, egal wie alt. Sonst
--    verschwaende ein Programm, das seit sechs Wochen schweigt, spurlos aus
--    der Uebersicht, und Schweigen waere dann nicht einmal mehr sichtbar.

create or replace function public.kc_system_check_usage()
returns jsonb
language sql
security definer
set search_path to 'pg_catalog', 'public'
set statement_timeout to '8s'
as $function$
  with fenster as (
    select * from public.kc_system_check_history
    where checked_at >= now() - interval '31 days'
  )
  select jsonb_build_object(
    'runs_31d', (select count(*) from fenster),
    'auto_31d', (select count(*) from fenster where trigger_type = 'auto'),
    'manual_31d', (select count(*) from fenster where trigger_type is distinct from 'auto'),
    'requests_31d', (select coalesce(sum(request_count), 0) from fenster),
    'response_bytes_31d', (select coalesce(sum(response_bytes), 0) from fenster),
    'non_green_31d', (select count(*) from fenster where overall_status is distinct from 'healthy'),
    'oldest_run_at', (select min(checked_at) from fenster),
    'counted_in_database', true
  );
$function$;

revoke all on function public.kc_system_check_usage() from public, anon, authenticated;
grant execute on function public.kc_system_check_usage() to service_role;

create or replace function public.kc_lebenszeichen_aufraeumen(p_tage int default 30)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare v_weg integer;
begin
  with juengste as (
    select distinct on (program_id) program_id, instance_id
    from public.kicc_program_heartbeats
    order by program_id, received_at desc
  ), weg as (
    delete from public.kicc_program_heartbeats h
    where h.received_at < now() - make_interval(days => greatest(p_tage, 7))
      and not exists (
        select 1 from juengste j
        where j.program_id = h.program_id and j.instance_id = h.instance_id
      )
    returning 1
  )
  select count(*) into v_weg from weg;
  return v_weg;
end;
$function$;

revoke all on function public.kc_lebenszeichen_aufraeumen(int) from public, anon, authenticated;
grant execute on function public.kc_lebenszeichen_aufraeumen(int) to service_role;

-- Eine Aufraeumfunktion, die niemand aufruft, raeumt nichts auf. Wo pg_cron
-- vorhanden ist, wird sie hier gleich eingeplant; wo nicht, schadet der Block
-- nichts und die Funktion bleibt von Hand aufrufbar.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('kc-lebenszeichen-aufraeumen-daily')
      where exists (select 1 from cron.job where jobname = 'kc-lebenszeichen-aufraeumen-daily');
    perform cron.schedule('kc-lebenszeichen-aufraeumen-daily', '40 3 * * *',
      'select public.kc_lebenszeichen_aufraeumen(30);');
  end if;
end $$;
