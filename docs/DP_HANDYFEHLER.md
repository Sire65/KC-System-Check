# Dienstplan · Handy-Fehler (KC-SC-DP-HANDYFEHLER, 0.10.8)

Freigabe Hansi 15.11.2026. Ersetzt die Fehlerampel aus dem Kassen-PC-Manager
(Kasse, Zweig `feature/kc-dp-error-monitor`, 16.08.2026), die nie in `main` kam:
Der heutige PC-Manager hat weder Cloud-Admin-Anmeldung noch Datenbankzugang,
KC System Check hat beides schon (Entwicklervertrag Regel 3: bestehende Kerne nutzen).

## Was angezeigt wird

Zusatzzeile in der Karte **„Kassen & Geräte“** der Betriebsübersicht:

| Zustand | Anzeige |
|---|---|
| keine offenen Fehler (frische Messung) | OK, grün |
| nur Warnungen offen | WARNUNG, gelb |
| Fehler oder kritisch offen | `n FEHLER`, rot |
| nicht angemeldet / keine Dienstplan-Rolle / Abfrage fehlgeschlagen | UNBEKANNT, grau – nie OK (Regel 11) |
| letzte Messung älter als 15 Min. | VERALTET, grau |

Offen = Status `new` oder `reviewed`. Gezeigt werden nur Zahlen (Fehlerbilder,
Vorkommnisse, Geräte) und die drei häufigsten Fehlercodes – **keine Namen,
Geräte-IDs, Fehlertexte oder Stacks**. Details bleiben im Diagnose-Center der Dienstplan-App.

## Quelle und Rechte

- RPC `kc_dp_error_admin_list_v2(p_limit)` im Projekt der Laufzeitkonfiguration,
  aufgerufen mit der Leitstand-Anmeldung (`js/session.js`), nie mit dem öffentlichen Schlüssel allein.
- Die Funktion selbst erlaubt nur aktive Dienstplan-Rollen `planner`, `duty_manager`, `admin`
  (`kc_dp_memberships`, Org `KC_WERNE`); andere Konten sehen UNBEKANNT.
- Fehler melden die Handys weiterhin über `kc_dp_report_error` (unverändert).

## Datensparsamkeit

Höchstens eine Abfrage je 5 Minuten, nur bei sichtbarem Fenster; sofort neu nach An-/Abmeldung.

## Definition of Done

- [x] `js/dp-handy-fehler.js` in `js/operations-overview.js` eingebunden
- [x] Tests `tests/dp-handy-fehler.test.js` (Ampel-Logik, UNBEKANNT ≠ OK, veraltet,
      keine personenbezogenen Texte, Sparsamkeit, Einbindung) in der CI-Matrix
- [x] Version 0.10.8 in `version.json`, `sw.js`, `js/updater.js`, `js/kicc-heartbeat.js`
- [x] Browser-Smoke ohne echten Server: Zeile erscheint als UNBEKANNT ohne Anmeldung
