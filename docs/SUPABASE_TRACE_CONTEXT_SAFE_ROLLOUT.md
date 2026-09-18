# Supabase Trace Context – sicherer Rollout

Stand: 2026-09-17
Branch: `feature/supabase-trace-safe`
Produktivzweig: `main` bleibt unverändert.

## Ziel

W3C Trace Context (`traceparent`, optional `tracestate` und `baggage`) soll künftig KC-Clientvorgänge mit Supabase-Logs korrelierbar machen. Die Erweiterung ist rein additiv und darf bestehende Prüf-, LIVE-, Backup-, Alarm- oder Telemetriepfade nicht verändern.

## Unverhandelbare Rückwärtskompatibilität

1. Fehlt Trace Context, läuft jeder bestehende Request unverändert weiter.
2. Kein bestehender Request wird wegen fehlender oder ungültiger Trace-Header abgewiesen.
3. Keine bestehende Datenbankfunktion, RLS-Policy, Rolle oder Berechtigung wird für Tracing verändert.
4. Keine produktive Edge Function wird aus diesem Branch automatisch deployed.
5. `main` wird erst nach grüner Regression und expliziter Freigabe verändert.
6. Trace-Daten sind Diagnosemetadaten, niemals Berechtigungsnachweis.
7. `baggage` darf keine Passwörter, Tokens, E-Mail-Adressen oder sonstige Geheimnisse enthalten.

## Stufen

### Stufe 0 – abgeschlossen

- Produktiven Ausgangsstand fixiert: `b8eb0e221f343e47bcb89069a636727d430bf14c`.
- Sicherheitsbranch `feature/supabase-trace-safe` angelegt.
- Keine Änderung an produktiver Supabase-Funktion.

### Stufe 1 – isolierter Trace-Helfer

Ein kleiner Helper soll ausschließlich gültige W3C-Header erkennen/weiterreichen. Ungültige Werte werden ignoriert. Bestehende Fetch-/Supabase-Aufrufe bleiben ohne Trace Context identisch.

### Stufe 2 – KC System Check zuerst

Tracing nur für einen klar abgegrenzten System-Check-Pfad aktivieren. Keine Änderung an DP, Kasse, KC Communication oder Backup Vault.

### Stufe 3 – Regression

Pflichtprüfungen vor jeder Übernahme:

- bestehende Unit-/SQL-/Browser-Tests grün;
- System Check ohne Trace Context verhält sich wie vorher;
- LIVE-Status unverändert;
- Backup-Vault-Telemetrie unverändert;
- Alarmierung unverändert;
- `unknown` bleibt `unknown` und wird nicht zu `healthy`;
- keine zusätzlichen Berechtigungen;
- keine Geheimnisse in Trace-Daten.

### Stufe 4 – kontrollierter Rollout

Erst nach Stufe 3 darf eine einzelne produktive Edge Function aktualisiert werden. Danach realen Request und Supabase-Log über `trace_id` korrelieren. Bei Abweichung sofort auf vorherige Version zurück.

## Geprüfte Supabase-Sicherheitsausnahmen

`kc_communication_push_erneuern` und `kc_dp_report_error` bleiben bewusst für `anon` erreichbar. Diese Rechte sind funktional erforderlich und werden nicht im Zuge des Trace-Rollouts verändert.

## Stop-Regel

Sobald eine Regression, ein ungeklärter Datenfluss oder eine Berechtigungsänderung sichtbar wird: Rollout stoppen. Keine nachgelagerte Stufe ausführen, bis die Ursache geklärt ist.
