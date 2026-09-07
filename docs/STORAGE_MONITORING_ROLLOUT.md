# Rollout Speicher- und Backup-Monitoring

## Stufe 1 – Vertrag und Parser

- Speicherstrategie dokumentieren.
- Backup-Vault-Telemetrievertrag festlegen.
- Read-only Adapter und Sicherheitstests bereitstellen.

## Stufe 2 – Transport

- Authentifizierten Snapshot-Kanal an die vorhandene Prüf-API anbinden.
- Keine Direktzugriffe des mobilen Browsers auf NAS/HiDrive.
- Alter des Snapshots messen; veraltete Daten als `unknown`/`warning`, nie als gesund darstellen.

## Stufe 3 – Kacheln

- PC Backup Vault
- NAS Backup
- HiDrive 1
- HiDrive 2

Jede Kachel zeigt mindestens Status, Alter der letzten Messung, letzten
Backup-/Verify-Zustand und – sofern zuverlässig verfügbar – Kapazität.

## Stufe 4 – Alarmierung

- NAS nicht erreichbar
- HiDrive nicht erreichbar
- Backup zu alt oder fehlgeschlagen
- Verify/Restore-Test fehlgeschlagen
- Kapazitätswarnung

## Stufe 5 – Notfall-Dokumente

Erst nach stabilem Monitoring. Der Zugriff wird getrennt vom Prüfkanal gebaut;
Monitoring-Telemetrie enthält niemals Dokumentinhalte oder Zugangsdaten.
