-- Additive, read-only Schema-Signatur für den KC System Check.
-- Noch nicht produktiv verdrahtet: dient als sichere Basis für 0.8.0.
-- Es werden ausschließlich Metadaten aus information_schema gelesen.
--
-- Für die Betriebsfähigkeit des Mirrors sind vorhandene Spalten und ihre
-- PostgreSQL-Datentypen entscheidend. Die physische Spaltenreihenfolge darf
-- zwischen Supabase und Neon abweichen und wird deshalb nicht bewertet.
-- Defaults, NOT NULL, Identity/Generated und ähnliche Constraints werden
-- ebenfalls absichtlich nicht in die Signatur aufgenommen.

create or replace function public.kc_system_check_schema_signature(
  p_schema text default 'public',
  p_tables text[] default null
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with selected_tables as (
    select r.table_name
    from public.kc_db_mirror_table_rules r
    where r.mirror_enabled is true
      and (p_tables is null or r.table_name = any(p_tables))
  ), cols as (
    select
      c.table_name,
      c.column_name,
      c.data_type,
      c.udt_name,
      coalesce(c.character_maximum_length::text, '') as character_maximum_length,
      coalesce(c.numeric_precision::text, '') as numeric_precision,
      coalesce(c.numeric_scale::text, '') as numeric_scale,
      coalesce(c.datetime_precision::text, '') as datetime_precision
    from information_schema.columns c
    join selected_tables s on s.table_name = c.table_name
    where c.table_schema = p_schema
  ), canonical as (
    select
      table_name,
      column_name,
      concat_ws('|',
        column_name,
        data_type,
        udt_name,
        character_maximum_length,
        numeric_precision,
        numeric_scale,
        datetime_precision
      ) as line
    from cols
  ), per_table as (
    select
      table_name,
      count(*)::int as column_count,
      md5(string_agg(line, E'\n' order by column_name)) as signature
    from canonical
    group by table_name
  )
  select jsonb_build_object(
    'checked_at', now(),
    'schema', p_schema,
    'mode', 'mirror_compatible_v2',
    'table_count', coalesce((select count(*) from per_table), 0),
    'column_count', coalesce((select count(*) from canonical), 0),
    'signature', coalesce((select md5(string_agg(table_name || ':' || signature, E'\n' order by table_name)) from per_table), md5('')),
    'tables', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'table', table_name,
          'column_count', column_count,
          'signature', signature
        ) order by table_name
      )
      from per_table
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.kc_system_check_schema_signature(text, text[]) from public;
revoke all on function public.kc_system_check_schema_signature(text, text[]) from anon;
revoke all on function public.kc_system_check_schema_signature(text, text[]) from authenticated;
grant execute on function public.kc_system_check_schema_signature(text, text[]) to service_role;

comment on function public.kc_system_check_schema_signature(text, text[]) is
  'Read-only Spiegel-Kompatibilitäts-Signatur v2: vergleicht Spaltennamen und PostgreSQL-Datentypen unabhängig von der physischen Reihenfolge.';
