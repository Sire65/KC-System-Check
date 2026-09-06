# KC System Check

Mobiler, modularer System-Leitstand als installierbare PWA.

Der aktuelle Stand steht in `version.json`. Was geprüft wird, steht in
[`docs/PRUEFKATALOG.md`](docs/PRUEFKATALOG.md).

## Die SQL-Überwachung weitergeben

Die Sicherheits- und Kapazitätsprüfung steckt nicht im Programm fest, sondern in
einem eigenständigen Paket: [`share/db-monitor/`](share/db-monitor/). Eine
einzelne SQL-Datei, die auf jeder PostgreSQL-Datenbank ab Version 13 läuft —
Supabase, Neon, eigener Server — und dort dieselben Befunde liefert:

```bash
psql "$DATABASE_URL" -f share/db-monitor/install.sql
psql "$DATABASE_URL" -c "select jsonb_pretty(db_monitor.report());"
```

Fehlen die Supabase-Rollen `anon`, `authenticated` und `service_role`, merkt die
Datei das und läuft trotzdem durch. Einzelheiten in
[`share/db-monitor/README.md`](share/db-monitor/README.md).

Der KC System Check benutzt dieses Paket selbst — die Serverfunktionen
`kc_system_check_security_audit` und `kc_system_check_db_capacity` rufen es nur
noch auf. Damit gibt es die Logik genau einmal.
