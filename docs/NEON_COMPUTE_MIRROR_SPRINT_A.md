# Sprint A – Neon Compute + Mirror-Effizienz

Stand: 2026-09-18

## Produktive Baseline
- Supabase Edge Function: `kc-db-mirror-worker`
- produktive Version bei Sicherung: v18
- EZBR SHA-256: `ca31bf5c3eaa8f8b8b3cd489cc58d9e451be7e407d11e5e824f87ebdf5a11f53`
- Baseline unverändert nach `supabase/functions/kc-db-mirror-worker/index.ts` übernommen.
- Produktiv wurde durch diese Sicherung nichts geändert.

## Befund
- 5-Minuten-Dispatcher wählt bis zu 20 Tabellen oldest-first.
- Worker öffnet Neon und schreibt/verifiziert Tabellen auch ohne fachliche Datenänderung.
- Messung: 5.740 erfolgreiche Snapshot-Läufe in 24 Stunden.
- Neon Free: Monatsbudget laut Betreiberhinweis 100 CU-h; gemessener Verbrauch am 18.09.2026 ca. 82,76 CU-h.

## Änderungsgate
1. Change Detection muss vor einem Ziel-Write greifen.
2. Bei unverändertem Source-Hash: kein DELETE/INSERT/UPSERT der Fachtabelle in Neon.
3. Referenz-Synchronisation darf ebenfalls nicht unnötig pro unveränderter Tabelle laufen.
4. Geänderte Tabellen müssen exakt den bisherigen v18-Schreib- und Verifikationsweg nutzen.
5. Fehler/Unknown dürfen niemals als gesund oder erfolgreich gespiegelt ausgegeben werden.
6. KC Check: echter Neon-Verbrauch, Restbudget, Reset, Trend/Forecast; API-Ausfall = unknown/warning.
7. Keine Secrets in Frontend oder Git.
8. Erst Tests/Regression, dann PR; Produktion erst nach grünem Gate.

## Sprint B Gate
Nach produktiver Freigabe reale Zyklen messen: changed/skipped, Wake-/CU-Verbrauch, Mirror-Lag, Failover, Warnkette, Regression/TÜV.
