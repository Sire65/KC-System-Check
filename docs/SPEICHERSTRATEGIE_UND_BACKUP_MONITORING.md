# Speicherstrategie und Backup-Monitoring

## Ziel

KC System Check bleibt der zentrale mobile Leitstand. PC Backup Vault bleibt fuer Backup, Verschluesselung, Verteilung und Restore verantwortlich. Beide Systeme werden nur ueber technische Statusdaten gekoppelt. Es werden keine Backup-Payloads, Originaldateipfade, Passwoerter, Recovery-Keys oder Cloud-Zugangsdaten an KC System Check uebertragen.

## Verantwortlichkeiten

| Komponente | Verantwortung |
| --- | --- |
| KC System Check | Ueberwachen, Status anzeigen, Warnen, mobilen Notfallzugriff vorbereiten |
| PC Backup Vault | Backup erstellen, verschluesseln, verteilen, pruefen und wiederherstellen |
| Supabase | Produktivdaten und KC-Systemstatus |
| Neon | Spiegel/Fallback fuer KC-Daten sowie eigene Backup-Vault-Verwaltungsdatenbank |
| NAS | lokales Haupt-Backup und grosse Datenmengen |
| HiDrive 1 | externe Sicherung wichtiger Dokumente und Notfalldaten |
| HiDrive 2 | zweite externe Sicherung fuer technische Notfall- und Recovery-Daten |

## Speicherklassen

### A - Notfall
Kleine, besonders wichtige Daten. Beispiele: ausgewaehlte Notfalldokumente, Wiederherstellungsunterlagen und andere explizit freigegebene Unterlagen.

Standardziel: NAS + HiDrive 1 + HiDrive 2.

### B - Wichtig
Dokumente, PDFs, Tabellen und Projektunterlagen mit hoher Wiederbeschaffungsrelevanz.

Standardziel: NAS + HiDrive 1.

### C - Grossdaten
Fotos, Medien, Archive, Images und normale PC-Sicherungen.

Standardziel: NAS; externe Kopie nur nach Regel oder Auswahl.

### D - Systemdaten
Strukturierte Daten, Backup-Kataloge, Historien, Hashes, Telemetrie und Datenbank-Exporte.

Standardziel: jeweilige Produktivdatenbank + Spiegel/Export nach definierter Regel. Keine grossen Backup-Payloads in Supabase oder Neon.

## Neue KC-System-Check-Pruefungen

Die neuen Pruefungen verwenden dasselbe Ergebnisformat wie die vorhandenen Checks: `id`, `name`, `kind`, `status`, `health`, `latency`, `usage`, `capacityLabel`, `detail`, `metrics`.

### `nas_backup`
Prueft:
- NAS erreichbar / nicht erreichbar
- Antwortzeit
- letzter Kontakt von Backup Vault
- letzter erfolgreicher Backup-Lauf auf dieses Ziel
- Alter des letzten erfolgreichen Laufs
- freie und belegte Kapazitaet, sofern Backup Vault sie verlaesslich messen kann
- letzter Verify-/Restore-Test fuer dieses Ziel

Statusregeln, erste Fassung:
- healthy: Ziel erreichbar und letzter erwarteter Backup-Lauf erfolgreich
- warning: erreichbar, aber Backup ueberfaellig, Kapazitaet knapp oder letzter Verify/Restore veraltet
- critical: Ziel nicht erreichbar, letzter Pflichtlauf fehlgeschlagen oder Kapazitaet blockiert neue Sicherungen
- unknown/not_configured: keine belastbare Telemetrie bzw. Ziel noch nicht eingerichtet

### `hidrive_1` und `hidrive_2`
Prueft getrennt je Konto:
- letzter erfolgreicher SFTP-Verbindungstest
- letzter erfolgreicher Backup-Lauf
- letzter Verify-/Restore-Test
- Alter der letzten erfolgreichen Aktivitaet
- Kapazitaet nur, wenn sie ueber den verwendeten Weg verlaesslich ermittelt werden kann

KC System Check fuehrt im Normalbetrieb keine schreibenden SFTP-Tests aus. Aktive Schreib-/Lese-/Loeschtests bleiben Aufgabe von Backup Vault/TUEV und werden nur als Ergebnis gemeldet.

### `backup_vault`
Gesamtzustand von PC Backup Vault:
- letzter Heartbeat
- App-Version
- letzter Jobstatus
- letzter erfolgreicher Job
- letzter Verify-Status
- letzter Restore-Test
- TUEV-Zustand
- Scheduler-Zustand
- Anzahl aktiver Warnungen/Fehler

## Schnittstelle PC Backup Vault -> KC System Check

Die Kopplung ist ausgehend und minimal. Backup Vault publiziert nur technische Telemetrie. KC System Check benoetigt keine direkten Zugangsdaten fuer NAS oder HiDrive.

Empfohlener Datensatz pro Meldung:

```json
{
  "schemaVersion": 1,
  "sourceProgram": "pc-backup-vault",
  "instanceId": "lokale-geraete-id",
  "timestamp": "ISO-8601",
  "appVersion": "1.x",
  "overallStatus": "healthy|warning|critical|unknown",
  "targets": [
    {
      "targetId": "nas-main",
      "kind": "NAS",
      "status": "healthy",
      "lastSuccessAt": "ISO-8601|null",
      "lastVerifyAt": "ISO-8601|null",
      "lastRestoreTestAt": "ISO-8601|null",
      "usageBytes": null,
      "capacityBytes": null,
      "latencyMs": null,
      "detailCode": "OK"
    }
  ],
  "lastJob": {
    "status": "SUCCESS|FAILED|CANCELLED|INTERRUPTED|RUNNING|null",
    "finishedAt": "ISO-8601|null",
    "targetIds": ["nas-main"],
    "fileCount": 0,
    "bytes": 0
  },
  "verify": {
    "status": "OK|WARNING|FAILED|UNKNOWN",
    "at": "ISO-8601|null"
  },
  "restore": {
    "status": "OK|WARNING|FAILED|UNKNOWN",
    "at": "ISO-8601|null"
  },
  "tuev": {
    "status": "OK|WARNING|FAILED|UNKNOWN",
    "at": "ISO-8601|null"
  }
}
```

Nicht uebertragen werden:
- Originaldateinamen und Originalpfade
- Dateiinhalte oder Backup-Chunks
- NAS-Benutzername/-Passwort
- HiDrive-Benutzername/-Passwort
- SSH-Private-Keys
- Neon/Supabase-DSNs
- B2/Cloud-Zugangsdaten
- Recovery-Key oder Recovery-Passwort

## Mobile Darstellung

Neuer Bereich `Speicher & Backup` in KC System Check:

1. Gesamtkarte Backup Vault
2. Einzelkarten NAS, HiDrive 1, HiDrive 2
3. Zeitstempel des letzten erfolgreichen Backups
4. Zeitstempel letzter Verify- und Restore-Test
5. Kapazitaetsanzeige nur bei belastbarer Messung
6. klare Ursache bei gelb/rot, nicht nur Farbe
7. Detailansicht mit Verlauf, aber ohne Geheimnisse und ohne Originaldateipfade

## Notfall-Dokumente - spaetere Ausbaustufe

Der mobile Zugriff auf wichtige Dokumente wird erst nach stabiler Monitoring-Anbindung umgesetzt. Er wird logisch vom Systemstatus getrennt. Nur explizit als mobil/notfallgeeignet markierte Inhalte duerfen sichtbar werden.

Fuer Zugangsdaten gilt: kein Klartext-Dokument in HiDrive. Falls spaeter ein Tresor integriert wird, nur Ende-zu-Ende-verschluesselt und mit eigener Freigabe, vorzugsweise Biometrie/PIN auf dem Mobilgeraet.

## Implementierungsreihenfolge

1. Telemetrievertrag finalisieren und versionieren.
2. Backup Vault: read-only Telemetrie-Snapshot erzeugen.
3. Sicheren Uebertragungsweg an den bestehenden KC-Leitstand anbinden.
4. KC System Check: `backup_vault`, `nas_backup`, `hidrive_1`, `hidrive_2` als neue Checks integrieren.
5. UI-Karten und Detailansicht ergaenzen.
6. Alarmregeln und Tests ergaenzen.
7. Erst danach mobilen Notfall-Dokumentzugriff entwerfen.

## Abnahmeregeln

- Bestehende Checks duerfen durch den Ausbau nicht veraendert oder schlechter bewertet werden.
- Fehlt eine Backup-Komponente, ist der Zustand `not_configured` statt rot.
- Ein alter oder fehlender Messwert darf nie als gesund dargestellt werden.
- KC System Check besitzt keine Backup-Zielpasswoerter.
- Ein verlorenes Handy darf keinen direkten Administrationszugriff auf NAS oder HiDrive ermoeglichen.
- Alle neuen Checks muessen im Pruefkatalog dokumentiert und durch Regressionstests abgedeckt werden.
