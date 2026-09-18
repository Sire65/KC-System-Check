alter table public.kicc_backup_telemetry
  add column if not exists last_backup_stored_bytes bigint;

comment on column public.kicc_backup_telemetry.last_backup_stored_bytes is
  'Stored payload bytes reported by PC Backup Vault; distinct from last_backup_bytes, which is the original source size.';
