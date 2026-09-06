-- "47 von 48 Tabellen frisch" ist eine Zahl, keine Antwort.
--
-- Anlass: am 2026-09-06 um 11:15 meldete die Spiegelung
-- "Privacy-Spiegelung unvollstaendig/frisch: 47/48 Tabellen innerhalb
-- 65 Minuten fehlerfrei gespiegelt." Diese Meldung gehoert zu einem Lauf ueber
-- den Gesamtzustand und traegt deshalb keine Tabelle. Wer nachsehen will,
-- welche der 48 fehlt, muss von Hand in kc_db_mirror_runs suchen - genau die
-- Arbeit, die eine Ueberwachung abnehmen soll.
--
-- Neu: die Momentaufnahme nennt die betroffenen Tabellen beim Namen. Massstab
-- ist derselbe wie im Text: der juengste abgeschlossene Lauf einer Tabelle ist
-- entweder nicht 'ok' oder aelter als 65 Minuten. Hoechstens fuenf Namen, damit
-- die Antwort klein bleibt.
--
-- Bewusst ohne kc_db_mirror_table_rules: die Liste entsteht aus den Laeufen
-- selbst. So funktioniert die Funktion auch dort, wo es die Regeltabelle nicht
-- gibt - fremde Umgebungen fuehren keine identischen Nebentabellen.

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
  ), je_tabelle as (
    select distinct on (metrics ->> 'table')
           metrics ->> 'table' as tabelle, started_at, status
    from public.kc_db_mirror_runs
    where started_at >= now() - interval '24 hours'
      and finished_at is not null
      and metrics ? 'table'
    order by metrics ->> 'table', started_at desc
  ), veraltet as (
    select tabelle, status, started_at
    from je_tabelle
    where status is distinct from 'ok'
       or started_at < now() - interval '65 minutes'
    order by started_at
    limit 5
  )
  select jsonb_build_object(
    'checked_at', now(),
    'database_bytes', pg_database_size(current_database()),
    'mirror', coalesce((select to_jsonb(latest) from latest), '{}'::jsonb),
    'runs_24h', (select runs_24h from day_stats),
    'non_ok_24h', (select non_ok_24h from day_stats),
    'mismatches_24h', (select mismatches_24h from day_stats),
    'last_issue', case when exists (select 1 from letzter_befund)
      then (select to_jsonb(letzter_befund) from letzter_befund)
           || jsonb_build_object(
                'veraltete_tabellen',
                coalesce((select jsonb_agg(to_jsonb(veraltet)) from veraltet), '[]'::jsonb))
      else null end
  );
$function$;

revoke all on function public.kc_system_check_snapshot() from public, anon, authenticated;
grant execute on function public.kc_system_check_snapshot() to service_role;
