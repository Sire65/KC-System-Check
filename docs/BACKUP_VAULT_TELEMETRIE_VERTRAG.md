# Vertrag: PC Backup Vault → KC System Check

Stand: 2026-09-07

## Zweck

KC System Check darf Backup Vault ausschließlich **read-only** überwachen. Die
Schnittstelle transportiert Betriebszustand und Prüfergebnisse, niemals
Backup-Nutzdaten oder Geheimnisse.

## Verbindliche Quelle

`sourceProgram` muss `pc-backup-vault` sein. Das aktuelle Schema ist `1.0`.

## Erlaubte Kerndaten

- Gesamtstatus von Backup Vault
- Zeitpunkt des Snapshots
- App-Version
- letzter Backup-Lauf: Status, Zeitpunkt, Dauer, Datenmenge, Ziel-ID
- Speicherziele: technische ID, Typ, Status, letzter Kontakt, Kapazitätswerte
- letzter Verify-Status
- letzter Restore-Test
- zusammengefasste Kapazitätswerte

## Verbotene Daten

Unter keinen Umständen werden übertragen:

- Kennwörter oder Credential-Tresor-Inhalte
- API-/Access-/Application-Keys oder Tokens
- Recovery-Key oder private Schlüssel
- DSN/Datenbankkennwörter
- Originaldateinamen oder Originalpfade
- entschlüsselte Dateinamen/Pfade
- Backup-Payloads oder Datei-Chunks

Der Browser-Adapter verweigert einen Snapshot bereits beim Auftreten eines
bekannten geheimnistragenden Feldnamens. Backup Vault entfernt dieselben Felder
vor Ausgabe zusätzlich rekursiv. Damit besteht die Sperre auf beiden Seiten.

## Ziel-IDs

Für die Speicherstrategie sind zunächst vorgesehen:

- `nas_backup`
- `hidrive_1`
- `hidrive_2`

Weitere Ziele dürfen später ergänzt werden, ohne die bestehenden IDs
umzudeuten.

## Statusmodell

Es gilt das bestehende KC-System-Check-Modell:

- `healthy`
- `warning`
- `critical`
- `unknown`
- `not_configured`

Ist ein einzelnes Speicherziel `critical`, wird `backup_vault` insgesamt
`critical`. Eine Zielwarnung hebt einen ansonsten gesunden Gesamtstatus auf
`warning` an. Fehlende oder unbekannte Werte werden niemals automatisch als
gesund behandelt.

## Transport

Der Adapter kennt bewusst keinen festen Transport. `loadSnapshot()` wird von
der späteren Integrationsschicht geliefert. Dadurch kann entschieden werden,
ob der Snapshot über die vorhandene KC-Prüf-API, eine abgesicherte
Telemetrietabelle oder einen anderen authentifizierten Kanal kommt, ohne die
Prüflogik oder das Sicherheitsmodell zu ändern.

Eine direkte öffentliche Verbindung vom Handy zu NAS oder HiDrive ist nicht
Teil dieses Vertrags.
