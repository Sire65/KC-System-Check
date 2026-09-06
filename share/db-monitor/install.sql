-- =============================================================================
-- db_monitor - tragbare SQL-Ueberwachung fuer PostgreSQL
-- =============================================================================
-- Laeuft auf jeder PostgreSQL-Datenbank ab Version 13: Supabase, Neon, RDS,
-- eigener Server. Keine Erweiterung noetig, kein Schreibzugriff, keine
-- Abhaengigkeit von einer bestimmten Anwendung. Gelesen werden ausschliesslich
-- Katalog- und Statistikdaten - nie Nutzdaten.
--
-- Einspielen:   psql "$DATABASE_URL" -f install.sql
-- Aufrufen:     select jsonb_pretty(db_monitor.report());
--
-- Herkunft: entstanden im KC System Check. Die dortigen Pruefungen rufen
-- dieselben Funktionen auf, damit es die Logik nur einmal gibt.
-- =============================================================================

create schema if not exists db_monitor;
comment on schema db_monitor is 'Tragbare SQL-Ueberwachung: Sicherheitslage und Kapazitaet aus Katalogdaten.';

-- -----------------------------------------------------------------------------
-- Sicherheitslage
-- -----------------------------------------------------------------------------
-- p_schema        welches Schema geprueft wird
-- p_client_roles  Rollen, die aus dem Netz erreichbar sind. Auf Supabase sind
--                 das anon und authenticated. Auf einer nackten PostgreSQL-
--                 Instanz gibt es sie nicht - dann bleibt die Liste einfach ohne
--                 Treffer, die Pruefung meldet nichts Falsches.
--
-- Ein Recht ist nur dann ein Befund, wenn es NICHTS deckt: eine Tabelle ohne
-- RLS, eine View mit Eigentuemerrechten oder eine materialisierte View. Ohne
-- diese Unterscheidung meldet die Pruefung auf Supabase hunderte harmloser
-- Standardrechte und wird dadurch wertlos.
create or replace function db_monitor.security_audit(
  p_schema text default 'public',
  p_client_roles text[] default array['anon','authenticated']
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with objects as (
    select c.oid, c.relname, c.relkind, c.relrowsecurity,
           coalesce('security_invoker=true' = any(c.reloptions), false) as invoker
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = p_schema and c.relkind in ('r','p','v','m')
  ), tables_without_rls as (
    select relname as name from objects
    where relkind in ('r','p') and not relrowsecurity
    order by 1
  ), views_bypassing_rls as (
    select o.relname || case when o.relkind = 'm' then ' (materialisiert)' else ' (View mit Eigentuemerrechten)' end as name
    from objects o
    where ((o.relkind = 'v' and not o.invoker) or o.relkind = 'm')
      and exists (
        select 1 from information_schema.role_table_grants g
        where g.table_schema::text = p_schema and g.table_name::text = o.relname
          and g.grantee::text = any(p_client_roles))
    order by 1
  ), permissive_policies as (
    select schemaname || '.' || tablename || ' · ' || policyname as name
    from pg_policies
    where schemaname = p_schema
      and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')
      and (roles::text[] && p_client_roles or 'public' = any(roles::text[]))
    order by 1
  ), uncovered_grants as (
    select g.grantee || ': ' || g.table_name || ' (' || g.privilege_type || ')' as name
    from information_schema.role_table_grants g
    join objects o on o.relname::text = g.table_name::text
    where g.table_schema::text = p_schema
      and g.grantee::text = any(p_client_roles)
      and g.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE')
      and ( (o.relkind in ('r','p') and not o.relrowsecurity)
         or (o.relkind = 'v' and not o.invoker)
         or o.relkind = 'm' )
    order by 1
  ), vorhandene_rollen as (
    -- Ohne Client-Rollen (nackte PostgreSQL, Neon ohne Data API) ist RLS keine
    -- Pflicht: es gibt niemanden, der die Tabelle aus dem Netz erreichen koennte.
    select r.rolname from pg_roles r where r.rolname = any(p_client_roles) order by 1
  ), functions_without_search_path as (
    -- security definer ohne festes search_path ist ein bekannter Angriffsweg
    select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = p_schema and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
    order by 1
  )
  select jsonb_build_object(
    'checked_at', now(),
    'schema', p_schema,
    'client_roles', to_jsonb(p_client_roles),
    'client_roles_present', coalesce((select jsonb_agg(rolname) from vorhandene_rollen), '[]'::jsonb),
    'tables_without_rls', coalesce((select jsonb_agg(name) from tables_without_rls), '[]'::jsonb),
    'views_bypassing_rls', coalesce((select jsonb_agg(name) from views_bypassing_rls), '[]'::jsonb),
    'permissive_policies', coalesce((select jsonb_agg(name) from permissive_policies), '[]'::jsonb),
    'uncovered_grants', coalesce((select jsonb_agg(name) from uncovered_grants), '[]'::jsonb),
    'definer_without_search_path', coalesce((select jsonb_agg(name) from functions_without_search_path), '[]'::jsonb)
  );
$$;

-- -----------------------------------------------------------------------------
-- Kapazitaet
-- -----------------------------------------------------------------------------
-- Verbindungen, groesste Tabellen, Sequenzausschoepfung, echter Vacuum-
-- Rueckstand, Leerraum im Heap und kaum genutzte Indexe.
--
-- "Rueckstand" heisst: mehr als das Doppelte dessen, wo Autovacuum ohnehin
-- eingreifen wuerde. Alles darunter ist Normalbetrieb und keine Meldung wert.
create or replace function db_monitor.capacity(
  p_schema text default 'public'
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with av as (
    select coalesce(nullif(current_setting('autovacuum_vacuum_threshold', true), '')::numeric, 50) as grund,
           coalesce(nullif(current_setting('autovacuum_vacuum_scale_factor', true), '')::numeric, 0.2) as anteil
  ), conn as (
    select count(*)::int as used,
           coalesce(nullif(current_setting('max_connections', true), '')::int, 0) as limit_total
    from pg_stat_activity
  ), largest as (
    select c.relname as name, pg_total_relation_size(c.oid) as bytes
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = p_schema and c.relkind in ('r','p')
    order by pg_total_relation_size(c.oid) desc
    limit 10
  ), seq as (
    select schemaname || '.' || sequencename as name,
           round((coalesce(last_value, 0)::numeric / nullif(max_value, 0)::numeric) * 100, 1) as used_percent
    from pg_sequences
    where schemaname = p_schema and max_value > 0
      and coalesce(last_value, 0)::numeric / nullif(max_value, 0)::numeric > 0.7
    order by 2 desc
  ), vac as (
    select t.relname as name, t.n_dead_tup as dead_tuples, t.n_live_tup as live_tuples,
           ((select grund from av) + (select anteil from av) * t.n_live_tup)::bigint as trigger_at,
           greatest(coalesce(extract(epoch from now() - t.last_autovacuum), 0),
                    coalesce(extract(epoch from now() - t.last_vacuum), 0))::bigint as vacuum_age_seconds
    from pg_stat_user_tables t
    where t.schemaname = p_schema
      and t.n_dead_tup > 2 * ((select grund from av) + (select anteil from av) * t.n_live_tup)
    order by t.n_dead_tup desc
    limit 5
  ), breite as (
    -- ::numeric ist notwendig: sonst teilt PostgreSQL ganzzahlig, der Bruch
    -- wird auf 0 gerundet und jede Tabelle erscheint als 100 % leer.
    select tablename, sum(avg_width)::numeric + 24 as zeilenbreite
    from pg_stats where schemaname = p_schema group by tablename
  ), bloat as (
    select t.relname as name, pg_relation_size(t.relid) as heap_bytes,
           round(100.0 * (1 - (t.n_live_tup * b.zeilenbreite) / nullif(pg_relation_size(t.relid), 0)), 1) as free_percent
    from pg_stat_user_tables t
    join breite b on b.tablename = t.relname
    where t.schemaname = p_schema
      and pg_relation_size(t.relid) > 10 * 1024 * 1024
      and t.n_live_tup > 0
      and round(100.0 * (1 - (t.n_live_tup * b.zeilenbreite) / nullif(pg_relation_size(t.relid), 0)), 1) > 30
    order by pg_relation_size(t.relid) desc
    limit 5
  ), idx as (
    select i.relname as table_name, i.indexrelname as name,
           pg_relation_size(i.indexrelid) as bytes, i.idx_scan as scans
    from pg_stat_user_indexes i
    join pg_index x on x.indexrelid = i.indexrelid
    where i.schemaname = p_schema
      and not x.indisprimary and not x.indisunique
      and pg_relation_size(i.indexrelid) > 5 * 1024 * 1024
      and i.idx_scan < 50
    order by pg_relation_size(i.indexrelid) desc
    limit 5
  )
  select jsonb_build_object(
    'checked_at', now(),
    'schema', p_schema,
    'connections', (select to_jsonb(conn) from conn),
    'database_bytes', pg_database_size(current_database()),
    'largest_tables', coalesce((select jsonb_agg(jsonb_build_object('table', name, 'bytes', bytes)) from largest), '[]'::jsonb),
    'sequences_near_limit', coalesce((select jsonb_agg(jsonb_build_object('sequence', name, 'used_percent', used_percent)) from seq), '[]'::jsonb),
    'vacuum_backlog', coalesce((select jsonb_agg(jsonb_build_object('table', name, 'dead_tuples', dead_tuples, 'live_tuples', live_tuples, 'trigger_at', trigger_at, 'vacuum_age_seconds', vacuum_age_seconds)) from vac), '[]'::jsonb),
    'bloat', coalesce((select jsonb_agg(jsonb_build_object('table', name, 'heap_bytes', heap_bytes, 'free_percent', free_percent)) from bloat), '[]'::jsonb),
    'unused_indexes', coalesce((select jsonb_agg(jsonb_build_object('table', table_name, 'index', name, 'bytes', bytes, 'scans', scans)) from idx), '[]'::jsonb)
  );
$$;

-- -----------------------------------------------------------------------------
-- Gesamtbericht
-- -----------------------------------------------------------------------------
-- Fasst beides zu einem Zustand zusammen. Bewusste Trennung:
--   critical  eine Client-Rolle erreicht Daten, die nichts schuetzt (Tabelle ohne
--             RLS, View mit Eigentuemerrechten, ungedecktes Recht); erschoepfte
--             Sequenz; Verbindungen ueber 90 %
--   warning   offene Lese-Policy, echter Vacuum-Rueckstand, schwerer Leerraum,
--             Verbindungen ueber 70 %, definer-Funktion ohne search_path
--   hinweise  Sparmoeglichkeiten - faerben nichts, sonst steht die Ampel
--             dauerhaft gelb und niemand liest sie mehr
create or replace function db_monitor.report(
  p_schema text default 'public',
  p_client_roles text[] default array['anon','authenticated']
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  s jsonb := db_monitor.security_audit(p_schema, p_client_roles);
  c jsonb := db_monitor.capacity(p_schema);
  conn jsonb := c -> 'connections';
  auslastung numeric := case when (conn ->> 'limit_total')::numeric > 0
                             then round((conn ->> 'used')::numeric / (conn ->> 'limit_total')::numeric * 100, 1) end;
  schwerer_leerraum jsonb;
  kritisch text[] := '{}';
  warnungen text[] := '{}';
  hinweise text[] := '{}';
  status text;
begin
  select coalesce(jsonb_agg(x), '[]'::jsonb) into schwerer_leerraum
  from jsonb_array_elements(c -> 'bloat') x
  where (x ->> 'free_percent')::numeric >= 50 and (x ->> 'heap_bytes')::bigint > 50 * 1024 * 1024;

  if jsonb_array_length(s -> 'tables_without_rls') > 0 and jsonb_array_length(s -> 'client_roles_present') > 0 then
    kritisch := kritisch || format('%s Tabelle(n) ohne RLS', jsonb_array_length(s -> 'tables_without_rls')); end if;
  if jsonb_array_length(s -> 'views_bypassing_rls') > 0 then
    kritisch := kritisch || format('%s View(s) umgehen RLS', jsonb_array_length(s -> 'views_bypassing_rls')); end if;
  if jsonb_array_length(s -> 'uncovered_grants') > 0 then
    kritisch := kritisch || format('%s ungedeckte Rechte', jsonb_array_length(s -> 'uncovered_grants')); end if;
  if jsonb_array_length(c -> 'sequences_near_limit') > 0 then
    kritisch := kritisch || format('%s Sequenz(en) ueber 70 %% ausgeschoepft', jsonb_array_length(c -> 'sequences_near_limit')); end if;
  if auslastung >= 90 then kritisch := kritisch || format('%s %% der Verbindungen belegt', auslastung); end if;

  if jsonb_array_length(s -> 'permissive_policies') > 0 then
    warnungen := warnungen || format('%s Policy(s) mit uneingeschraenktem Zugriff', jsonb_array_length(s -> 'permissive_policies')); end if;
  if jsonb_array_length(s -> 'definer_without_search_path') > 0 then
    warnungen := warnungen || format('%s security-definer-Funktion(en) ohne festes search_path', jsonb_array_length(s -> 'definer_without_search_path')); end if;
  if jsonb_array_length(c -> 'vacuum_backlog') > 0 then
    warnungen := warnungen || format('%s Tabelle(n) mit echtem Vacuum-Rueckstand', jsonb_array_length(c -> 'vacuum_backlog')); end if;
  if jsonb_array_length(schwerer_leerraum) > 0 then
    warnungen := warnungen || format('%s grosse Tabelle(n) mit ueber 50 %% Leerraum', jsonb_array_length(schwerer_leerraum)); end if;
  if auslastung >= 70 and auslastung < 90 then warnungen := warnungen || format('%s %% der Verbindungen belegt', auslastung); end if;

  if jsonb_array_length(c -> 'unused_indexes') > 0 then
    hinweise := hinweise || format('%s kaum genutzte(r) Index, %s MB frei machbar',
      jsonb_array_length(c -> 'unused_indexes'),
      round((select coalesce(sum((x ->> 'bytes')::bigint), 0) from jsonb_array_elements(c -> 'unused_indexes') x) / 1048576.0, 1)); end if;
  if jsonb_array_length(c -> 'bloat') > 0 and jsonb_array_length(schwerer_leerraum) = 0 then
    -- ::text ist notwendig: ohne Typangabe haelt PostgreSQL den Text fuer eine
    -- Array-Angabe und bricht ab. Bei format() faellt es nicht auf, weil dessen
    -- Ergebnis schon als text bekannt ist.
    hinweise := hinweise || 'Leerraum im normalen Rahmen, wird wiederverwendet'::text; end if;
  if jsonb_array_length(s -> 'tables_without_rls') > 0 and jsonb_array_length(s -> 'client_roles_present') = 0 then
    hinweise := hinweise || format('%s Tabelle(n) ohne RLS, aber keine der geprueften Client-Rollen existiert - kein Zugriff aus dem Netz moeglich',
      jsonb_array_length(s -> 'tables_without_rls')); end if;

  status := case when cardinality(kritisch) > 0 then 'critical'
                 when cardinality(warnungen) > 0 then 'warning'
                 else 'healthy' end;

  return jsonb_build_object(
    'checked_at', now(),
    'schema', p_schema,
    'status', status,
    'critical', to_jsonb(kritisch),
    'warnings', to_jsonb(warnungen),
    'notes', to_jsonb(hinweise),
    'connection_percent', auslastung,
    'security', s,
    'capacity', c
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Rechte: niemand ausser dem Server darf diese Funktionen aufrufen.
-- Auf Supabase existiert service_role, auf nackten Instanzen nicht - deshalb
-- wird nur vergeben, was es auch gibt.
-- -----------------------------------------------------------------------------
do $$
declare f text;
begin
  revoke all on schema db_monitor from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema db_monitor to service_role';
  end if;

  for f in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'db_monitor'
  loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f); end if;
  end loop;
end $$;
