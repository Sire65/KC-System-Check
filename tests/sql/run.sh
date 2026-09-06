#!/usr/bin/env bash
# Startet keine Datenbank, sondern erwartet eine erreichbare Instanz.
# Lokal:  PGHOST=/tmp PGPORT=5433 PGUSER=postgres tests/sql/run.sh
# In CI:  ueber den postgres-Service (siehe .github/workflows/test.yml)
set -euo pipefail
DB="${PGDATABASE:-kc_system_check_test}"
psql -v ON_ERROR_STOP=1 -q -c "drop database if exists ${DB};" -d postgres
psql -v ON_ERROR_STOP=1 -q -c "create database ${DB};" -d postgres
psql -v ON_ERROR_STOP=1 -q -d "${DB}" -f tests/sql/migrations.test.sql

# Das tragbare Paket in einer eigenen Datenbank, damit die Rollenlage der
# KC-Pruefung das Ergebnis nicht faelscht.
PAKET="${DB}_db_monitor"
psql -v ON_ERROR_STOP=1 -q -c "drop database if exists ${PAKET};" -d postgres
psql -v ON_ERROR_STOP=1 -q -c "create database ${PAKET};" -d postgres
psql -v ON_ERROR_STOP=1 -q -d "${PAKET}" -f tests/sql/db-monitor.test.sql
