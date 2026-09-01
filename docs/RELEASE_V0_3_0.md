# KC System Check v0.3.0

## Umgesetzt
- Versionsnummer dauerhaft im Kopf.
- KC Core und Future Academy getrennt gemessen und dargestellt.
- Gesamtstatus folgt der höchsten aktiven Warnstufe statt einem reinen Durchschnitt.
- Spiegelung zeigt Abweichungen und Alter statt einer erfundenen 0-ms-Latenz.
- Neon-Direktadapter ist vorbereitet; ohne sichere Server-Konfiguration wird `unknown` angezeigt und nicht fälschlich grün.
- B2 bleibt ohne Read-only-Konfiguration deaktiviert; es gibt keine Test-Uploads.
- Serverseitige Historie und Prüfverbrauch werden kompakt gespeichert.
- Kapazität basiert nur auf realen DB-Größen. Supabase-Free-Grenze: 500 MB je Projekt.
- Wachstum/Prognose wird erst angezeigt, wenn genügend echte historische Messpunkte vorhanden sind.
- Täglicher Standardcheck läuft serverseitig über GitHub Actions, maximal einmal täglich; die PWA muss nicht geöffnet sein.
- Browser-Benachrichtigung bei Gelb/Rot ist für geöffnete/aktive App vorbereitet.

## Bewusste Grenzen
Ein echter Neon-Direkttest benötigt eine sichere serverseitige Neon-Health-URL oder Datenbankverbindung. B2 benötigt read-only Zugangsdaten. Diese Werte werden bis dahin als unknown/deaktiviert ausgewiesen, nie simuliert.
