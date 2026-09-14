-- KC System Check: kurzzeitige Autovacuum-Spitzen nicht als echten Vorfall alarmieren.
-- Hintergrund 14.09.2026: zwei kleine Communication-Tabellen lagen fuer ca. 45 Minuten
-- ueber dem Dead-Tuple-Schwellwert. Autovacuum hat sie selbst bereinigt. Der bisherige
-- Monitor wertete bereits den kurzfristigen Schwellwertuebertritt als GELB.
--
-- Neue Regel: Ein Vacuum-Rueckstand wird erst als Warnung gewertet, wenn der vom
-- Kapazitaetsmonitor gemeldete Rueckstand seit mindestens 60 Minuten besteht.
-- Juengere Befunde bleiben als Hinweis sichtbar und loesen keinen Alarm aus.

create or replace function db_monitor.report(
  p_schema text default 'public'::text,
  p_client_roles text[] default array['anon'::text, 'authenticated'::text]
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public'
as $func$
declare
  s jsonb := db_monitor.security_audit(p_schema, p_client_roles);
  c jsonb := db_monitor.capacity(p_schema);
  conn jsonb := c -> 'connections';
  auslastung numeric := case when (conn ->> 'limit_total')::numeric > 0
                             then round((conn ->> 'used')::numeric / (conn ->> 'limit_total')::numeric * 100, 1) end;
  schwerer_leerraum jsonb;
  echter_vacuum jsonb;
  kritisch text[] := '{}';
  warnungen text[] := '{}';
  hinweise text[] := '{}';
  status text;
begin
  select coalesce(jsonb_agg(x), '[]'::jsonb) into schwerer_leerraum
  from jsonb_array_elements(c -> 'bloat') x
  where (x ->> 'free_percent')::numeric >= 50
    and (x ->> 'heap_bytes')::bigint > 50 * 1024 * 1024;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into echter_vacuum
  from jsonb_array_elements(coalesce(c -> 'vacuum_backlog', '[]'::jsonb)) x
  where coalesce((x ->> 'vacuum_age_seconds')::bigint, 0) >= 3600;

  if jsonb_array_length(s -> 'tables_without_rls') > 0
     and jsonb_array_length(s -> 'client_roles_present') > 0 then
    kritisch := kritisch || format('%s Tabelle(n) ohne RLS', jsonb_array_length(s -> 'tables_without_rls'));
  end if;
  if jsonb_array_length(s -> 'views_bypassing_rls') > 0 then
    kritisch := kritisch || format('%s View(s) umgehen RLS', jsonb_array_length(s -> 'views_bypassing_rls'));
  end if;
  if jsonb_array_length(s -> 'uncovered_grants') > 0 then
    kritisch := kritisch || format('%s ungedeckte Rechte', jsonb_array_length(s -> 'uncovered_grants'));
  end if;
  if jsonb_array_length(c -> 'sequences_near_limit') > 0 then
    kritisch := kritisch || format('%s Sequenz(en) ueber 70 %% ausgeschoepft', jsonb_array_length(c -> 'sequences_near_limit'));
  end if;
  if auslastung >= 90 then
    kritisch := kritisch || format('%s %% der Verbindungen belegt', auslastung);
  end if;

  if jsonb_array_length(s -> 'permissive_policies') > 0 then
    warnungen := warnungen || format('%s Policy(s) mit uneingeschraenktem Zugriff', jsonb_array_length(s -> 'permissive_policies'));
  end if;
  if jsonb_array_length(s -> 'definer_without_search_path') > 0 then
    warnungen := warnungen || format('%s security-definer-Funktion(en) ohne festes search_path', jsonb_array_length(s -> 'definer_without_search_path'));
  end if;
  if jsonb_array_length(echter_vacuum) > 0 then
    warnungen := warnungen || format('%s Tabelle(n) mit echtem Vacuum-Rueckstand seit mindestens 60 Minuten', jsonb_array_length(echter_vacuum));
  end if;
  if jsonb_array_length(coalesce(c -> 'vacuum_backlog', '[]'::jsonb)) > jsonb_array_length(echter_vacuum) then
    hinweise := hinweise || format('%s Tabelle(n) warten kurzzeitig auf Autovacuum - noch kein Vorfall',
      jsonb_array_length(c -> 'vacuum_backlog') - jsonb_array_length(echter_vacuum));
  end if;
  if jsonb_array_length(schwerer_leerraum) > 0 then
    warnungen := warnungen || format('%s grosse Tabelle(n) mit ueber 50 %% Leerraum', jsonb_array_length(schwerer_leerraum));
  end if;
  if auslastung >= 70 and auslastung < 90 then
    warnungen := warnungen || format('%s %% der Verbindungen belegt', auslastung);
  end if;

  if jsonb_array_length(c -> 'unused_indexes') > 0 then
    hinweise := hinweise || format('%s kaum genutzte(r) Index, %s MB frei machbar',
      jsonb_array_length(c -> 'unused_indexes'),
      round((select coalesce(sum((x ->> 'bytes')::bigint), 0)
             from jsonb_array_elements(c -> 'unused_indexes') x) / 1048576.0, 1));
  end if;
  if jsonb_array_length(c -> 'bloat') > 0 and jsonb_array_length(schwerer_leerraum) = 0 then
    hinweise := hinweise || 'Leerraum im normalen Rahmen, wird wiederverwendet'::text;
  end if;
  if jsonb_array_length(s -> 'tables_without_rls') > 0
     and jsonb_array_length(s -> 'client_roles_present') = 0 then
    hinweise := hinweise || format('%s Tabelle(n) ohne RLS, aber keine der geprueften Client-Rollen existiert - kein Zugriff aus dem Netz moeglich',
      jsonb_array_length(s -> 'tables_without_rls'));
  end if;

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
$func$;
