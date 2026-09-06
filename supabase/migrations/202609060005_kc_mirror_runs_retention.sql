-- Tageskennzahlen der Spiegelung bewahren.
--
-- Ausgangslage (gemessen am 2026-09-06): kc_internal.kc_db_mirror_retention_cleanup()
-- loescht taeglich um 03:17 alle Spiegellaeufe aelter als 14 Tage. Das haelt die
-- Tabelle stabil bei rund 149 MB - die Datenbank waechst also nicht unbegrenzt.
-- Verloren geht dabei aber jede Kennzahl: nach 14 Tagen ist nicht mehr
-- feststellbar, wie viele Laeufe es gab, wie viele auffaellig waren und wie hoch
-- der Replikationsverzug lag.
--
-- Diese Migration ergaenzt daher NUR die Verdichtung, sie loescht nichts. Der
-- bestehende Aufraeumer bleibt der einzige, der loescht - kein zweiter Kern fuer
-- dieselbe Aufgabe.

create table if not exists public.kc_db_mirror_runs_daily (
  day date primary key,
  runs bigint not null,
  non_ok bigint not null,
  mismatches bigint not null,
  max_lag_sec numeric,
  avg_lag_sec numeric,
  first_run_at timestamptz,
  last_run_at timestamptz,
  aggregated_at timestamptz not null default now()
);

comment on table public.kc_db_mirror_runs_daily is
  'Tageszusammenfassung der Spiegellaeufe. Ueberlebt die 14-Tage-Aufbewahrung von kc_db_mirror_runs.';

alter table public.kc_db_mirror_runs_daily enable row level security;
revoke all on table public.kc_db_mirror_runs_daily from anon, authenticated;

drop policy if exists kc_db_mirror_runs_daily_deny_anon on public.kc_db_mirror_runs_daily;
create policy kc_db_mirror_runs_daily_deny_anon on public.kc_db_mirror_runs_daily
for all to anon, authenticated
using (false)
with check (false);

-- Verdichtet abgeschlossene Tage. Idempotent: mehrfacher Aufruf aendert nichts.
create or replace function public.kc_db_mirror_daily_rollup()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_days integer;
begin
  insert into public.kc_db_mirror_runs_daily (day, runs, non_ok, mismatches, max_lag_sec, avg_lag_sec, first_run_at, last_run_at)
  select date_trunc('day', started_at)::date,
         count(*),
         count(*) filter (where status is distinct from 'ok'),
         coalesce(sum(mismatch_count), 0),
         max(replication_lag_sec),
         round(avg(replication_lag_sec), 2),
         min(started_at),
         max(started_at)
  from public.kc_db_mirror_runs
  where started_at < date_trunc('day', now())
  group by 1
  on conflict (day) do update set
    runs = excluded.runs, non_ok = excluded.non_ok, mismatches = excluded.mismatches,
    max_lag_sec = excluded.max_lag_sec, avg_lag_sec = excluded.avg_lag_sec,
    first_run_at = excluded.first_run_at, last_run_at = excluded.last_run_at,
    aggregated_at = now();
  get diagnostics v_days = row_count;

  return jsonb_build_object(
    'aggregated_days', v_days,
    'known_days', (select count(*) from public.kc_db_mirror_runs_daily),
    'oldest_summary', (select min(day) from public.kc_db_mirror_runs_daily),
    'deletes_nothing', true
  );
end;
$$;

revoke all on function public.kc_db_mirror_daily_rollup() from public, anon, authenticated;
grant execute on function public.kc_db_mirror_daily_rollup() to service_role;

-- Falls eine frueher angelegte, konkurrierende Aufbewahrung existiert: entfernen.
-- Es darf nur einen Aufraeumer geben, und das ist der bestehende in kc_internal.
drop function if exists public.kc_db_mirror_runs_retention(integer, boolean);
