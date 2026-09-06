-- Kapazitaetspruefung nachkalibriert.
--
-- Befund am 2026-09-06: die Pruefung meldete "1 Tabelle(n) mit Vacuum-Rueckstand"
-- fuer kc_db_mirror_runs - 15.864 tote Zeilen bei 112.168 lebenden. Autovacuum
-- laeuft dort aber voellig normal: es greift erst bei
-- autovacuum_vacuum_threshold + scale_factor * lebende Zeilen, also bei rund
-- 22.500. Die Tabelle lag darunter. Die alte Schwelle (mehr als 1.000 tote
-- Zeilen, absolut) meldet damit den Normalbetrieb jeder groesseren Tabelle -
-- dieselbe Sorte Fehlalarm wie die 244 "ungedeckten" Rechte vorher.
--
-- Neu wird gemeldet, was wirklich ein Rueckstand ist: mehr als das Doppelte
-- der Ausloeseschwelle. Dann kommt Autovacuum nicht mehr hinterher.
--
-- Zwei Dinge, die die Handpruefung gefunden hat, sucht die Pruefung jetzt selbst:
--
--   bloat            - freier Raum im Heap. kc_db_mirror_runs: 119 MB Heap fuer
--                      rund 69 MB Nutzdaten, also 42 % Leerraum. Bei staendigem
--                      Aendern und Loeschen ist das normal und wird
--                      wiederverwendet; erst viel Leerraum in einer grossen
--                      Tabelle ist auf einem 500-MB-Kontingent eine Meldung wert.
--   unused_indexes   - grosse Indexe, die kaum je benutzt werden.
--                      kc_db_mirror_runs_policy_idx: 11 MB, neun Zugriffe,
--                      und 110.802 von 112.168 Zeilen haben gar keine
--                      policy_id. Solcher Speicher laesst sich ohne Sperre und
--                      ohne Datenverlust zurueckgewinnen.

create or replace function public.kc_system_check_db_capacity()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  with conn as (
    select count(*)::int as used,
           coalesce(nullif(current_setting('max_connections', true), '')::int, 0) as limit_total
    from pg_stat_activity
  ), largest as (
    select c.relname as table_name, pg_total_relation_size(c.oid) as bytes
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by pg_total_relation_size(c.oid) desc
    limit 10
  ), seq as (
    select schemaname || '.' || sequencename as sequence_name,
           round((coalesce(last_value, 0)::numeric / nullif(max_value, 0)::numeric) * 100, 1) as used_percent
    from pg_sequences
    where schemaname = 'public'
      and max_value > 0
      and coalesce(last_value, 0)::numeric / nullif(max_value, 0)::numeric > 0.7
    order by 2 desc
  ), vac as (
    -- Rueckstand heisst: mehr als das Doppelte dessen, wo Autovacuum ohnehin
    -- eingreifen wuerde. Alles darunter ist Normalbetrieb.
    select relname as table_name, n_dead_tup as dead_tuples, n_live_tup as live_tuples,
           (coalesce(nullif(current_setting('autovacuum_vacuum_threshold', true), '')::numeric, 50)
            + coalesce(nullif(current_setting('autovacuum_vacuum_scale_factor', true), '')::numeric, 0.2)
              * n_live_tup)::bigint as trigger_at,
           greatest(coalesce(extract(epoch from now() - last_autovacuum), 0),
                    coalesce(extract(epoch from now() - last_vacuum), 0))::bigint as vacuum_age_seconds
    from pg_stat_user_tables
    where schemaname = 'public'
      and n_dead_tup > 2 * (coalesce(nullif(current_setting('autovacuum_vacuum_threshold', true), '')::numeric, 50)
            + coalesce(nullif(current_setting('autovacuum_vacuum_scale_factor', true), '')::numeric, 0.2) * n_live_tup)
    order by n_dead_tup desc
    limit 5
  ), breite as (
    -- ::numeric ist notwendig: sonst teilt Postgres ganzzahlig und der
    -- Bruch wird auf 0 gerundet, was jede Tabelle als 100 % leer meldet.
    select tablename, sum(avg_width)::numeric + 24 as zeilenbreite
    from pg_stats where schemaname = 'public' group by tablename
  ), bloat as (
    select t.relname as table_name,
           pg_relation_size(t.relid) as heap_bytes,
           round(100.0 * (1 - (t.n_live_tup * b.zeilenbreite) / nullif(pg_relation_size(t.relid), 0)), 1) as free_percent
    from pg_stat_user_tables t
    join breite b on b.tablename = t.relname
    where t.schemaname = 'public'
      and pg_relation_size(t.relid) > 10 * 1024 * 1024
      and t.n_live_tup > 0
      and round(100.0 * (1 - (t.n_live_tup * b.zeilenbreite) / nullif(pg_relation_size(t.relid), 0)), 1) > 30
    order by pg_relation_size(t.relid) desc
    limit 5
  ), idx as (
    select i.relname as table_name, i.indexrelname as index_name,
           pg_relation_size(i.indexrelid) as bytes, i.idx_scan as scans
    from pg_stat_user_indexes i
    join pg_index x on x.indexrelid = i.indexrelid
    where i.schemaname = 'public'
      and not x.indisprimary and not x.indisunique
      and pg_relation_size(i.indexrelid) > 5 * 1024 * 1024
      and i.idx_scan < 50
    order by pg_relation_size(i.indexrelid) desc
    limit 5
  )
  select jsonb_build_object(
    'checked_at', now(),
    'connections', (select to_jsonb(conn) from conn),
    'largest_tables', coalesce((select jsonb_agg(jsonb_build_object('table', table_name, 'bytes', bytes)) from largest), '[]'::jsonb),
    'sequences_near_limit', coalesce((select jsonb_agg(jsonb_build_object('sequence', sequence_name, 'used_percent', used_percent)) from seq), '[]'::jsonb),
    'vacuum_backlog', coalesce((select jsonb_agg(jsonb_build_object('table', table_name, 'dead_tuples', dead_tuples, 'live_tuples', live_tuples, 'trigger_at', trigger_at, 'vacuum_age_seconds', vacuum_age_seconds)) from vac), '[]'::jsonb),
    'bloat', coalesce((select jsonb_agg(jsonb_build_object('table', table_name, 'heap_bytes', heap_bytes, 'free_percent', free_percent)) from bloat), '[]'::jsonb),
    'unused_indexes', coalesce((select jsonb_agg(jsonb_build_object('table', table_name, 'index', index_name, 'bytes', bytes, 'scans', scans)) from idx), '[]'::jsonb)
  );
$$;

revoke all on function public.kc_system_check_db_capacity() from public, anon, authenticated;
grant execute on function public.kc_system_check_db_capacity() to service_role;
