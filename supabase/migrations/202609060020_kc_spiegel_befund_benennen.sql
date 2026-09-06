-- Die Spiegelkachel sagte "Spiegelung mit Warnhinweis" und sonst nichts.
--
-- Anlass, und es war der eigene Fehler: am 2026-09-06 um 10:44 bekam
-- kc_core_app_registry drei neue Spalten fuer die Lebenszeichen. Der Spiegel
-- in Neon hatte sie nicht. Die Verifikation vergleicht Zeilen als JSON - die
-- Quelle trug drei Schluessel mehr, die Hashes gingen auseinander, und um
-- 11:00 meldete der Lauf "kc_core_app_registry: verification mismatch".
--
-- In der Kachel stand davon nichts. Die Momentaufnahme liefert Zaehler, aber
-- nicht den Grund - message und metrics des betroffenen Laufs blieben liegen.
-- Ein Warnhinweis, der nicht sagt, worueber er warnt, kostet genau die Zeit,
-- die eine Ueberwachung sparen soll.
--
-- Neu: der juengste auffaellige Lauf der letzten 24 Stunden kommt mit. Tabelle,
-- Meldung, Zeitpunkt. Nichts weiter - kein zweiter Kern, nur das, was ohnehin
-- schon in kc_db_mirror_runs steht.
--
-- Merksatz, der aus diesem Vorfall bleibt: wer eine gespiegelte Tabelle
-- aendert, muss den Spiegel nachziehen. Es gibt dafuer keine Automatik, und
-- gemerkt wird es erst beim naechsten Lauf.

create or replace function public.kc_system_check_snapshot()
returns jsonb
language sql
security definer
set search_path to 'pg_catalog', 'public'
set statement_timeout to '12s'
as $function$
  with latest as (
    select status, started_at, finished_at, source_rows, target_rows,
           replication_lag_sec, mismatch_count
    from public.kc_db_mirror_runs
    where finished_at is not null
      and status is distinct from 'running'
    order by finished_at desc, started_at desc
    limit 1
  ), day_stats as (
    select count(*) filter (where finished_at is not null)::bigint as runs_24h,
           count(*) filter (
             where finished_at is not null
               and status is distinct from 'ok'
           )::bigint as non_ok_24h,
           coalesce(sum(mismatch_count) filter (where finished_at is not null),0)::bigint as mismatches_24h
    from public.kc_db_mirror_runs
    where started_at >= now() - interval '24 hours'
  ), letzter_befund as (
    select started_at, status, message, metrics ->> 'table' as tabelle
    from public.kc_db_mirror_runs
    where started_at >= now() - interval '24 hours'
      and finished_at is not null
      and (status is distinct from 'ok' or coalesce(mismatch_count,0) > 0)
    order by started_at desc
    limit 1
  )
  select jsonb_build_object(
    'checked_at', now(),
    'database_bytes', pg_database_size(current_database()),
    'mirror', coalesce((select to_jsonb(latest) from latest), '{}'::jsonb),
    'runs_24h', (select runs_24h from day_stats),
    'non_ok_24h', (select non_ok_24h from day_stats),
    'mismatches_24h', (select mismatches_24h from day_stats),
    'last_issue', (select to_jsonb(letzter_befund) from letzter_befund)
  );
$function$;

revoke all on function public.kc_system_check_snapshot() from public, anon, authenticated;
grant execute on function public.kc_system_check_snapshot() to service_role;
