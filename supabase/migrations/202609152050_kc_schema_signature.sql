-- Additive, read-only Schema-Signatur für den KC System Check.
-- Noch nicht produktiv verdrahtet: dient als sichere Basis für 0.8.0.
-- Es werden ausschließlich Metadaten aus information_schema gelesen.
--
-- WICHTIG: Die Neon-Spiegelung darf bewusst lockerere Constraints besitzen
-- (z. B. nullable Spalten). Für die Betriebsfähigkeit des Mirrors sind daher
-- Spaltenname, Reihenfolge und PostgreSQL-Datentyp entscheidend. Defaults,
-- NOT NULL, Identity/Generated und ähnliche Constraints werden absichtlich
-- NICHT in die Signatur aufgenommen, damit es keine Fehlalarme gibt.

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
      c.ordinal_position,
      c.column_name,
      c.data_type,
      c.udt_name
    from information_schema.columns c
    join selected_tables s on s.table_name = c.table_name
    where c.table_schema = p_schema
  ), canonical as (
    select
      table_name,
      ordinal_position,
      concat_ws('|',
        ordinal_position::text,
        column_name,
        data_type,
        udt_name
      ) as line
    from cols
  ), per_table as (
    select
      table_name,
      count(*)::int as column_count,
      md5(string_agg(line, E'\n' order by ordinal_position)) as signature
    from canonical
    group by table_name
  )
  select jsonb_build_object(
    'checked_at', now(),
    'schema', p_schema,
    'mode', 'mirror_compatible_v1',
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
  'Read-only Spiegel-Kompatibilitäts-Signatur: vergleicht Spaltenname, Reihenfolge und Datentyp; liest ausschließlich Metadaten.';
