# CLAUDE_PRUEFBERICHT – KC System Check v0.7.30: Datenfluss-Karte + Überwachungsläufe

Datum: 07.09.2026 · Basis: `Sire65/KC-System-Check` v0.7.29 (Commit 06.09. „Eine Aufraeumfunktion, die niemand aufruft…"). Enthält zusätzlich Schritt A (Edge Function `kc-system-check`, siehe Bericht von heute früh).

## Was gebaut wurde

### Neu: `js/datenfluss.js` (ein Modul, 3 Aufgaben)

1. **Datenfluss-Karte** im LIVE-Tab, als eigene Karte vor der bestehenden Liste „Datenflüsse". Drei Spalten (Programme · Supabase · Sicherung), Kanten mit laufenden Punkten für Verkehr der letzten 60 s, grau = still, gestrichelt = über 2 min keine Meldung, rot = Fehler. Lampe im Knoten aus den Heartbeats (Programm lebt, auch wenn gerade nichts fließt). Tippen auf eine Kante zeigt Ereignisse, Bytes, letzte Aktivität und Quelle. 18 px breiter unsichtbarer Treffbereich, weil dünne Linien am Handy sonst nicht zu treffen sind. `prefers-reduced-motion` wird beachtet.
2. **Broadcast-Client** für den Kanal `kc-datenfluss` (Supabase Realtime, Phoenix-Protokoll). Bewusst ~40 Zeilen eigener Websocket-Code statt supabase-js: die PWA lädt keine Fremdbibliothek (Manifest-Hashes, Offline-Betrieb). Automatischer Neuaufbau alle 5 s bei Trennung. Badge in der Karte: LIVE / GETRENNT / SCHNAPPSCHUSS.
3. **Überwachungsläufe** als eigene Karte: System-Check, Spiegelung, Backup+Verify, PC Backup Vault, Lebenszeichen – mit letztem Lauf, Sollzeit und Ergebnis. **Ausbleiben ist ein Befund:** Sollzeit überschritten → gelb, doppelt überschritten → rot, auch wenn die Kachel selbst noch grün war. Rot wird nie besser gerechnet.

Sollzeiten (aus den Cron-Plänen abgeleitet): System-Check 20 min, Spiegelung 45 min, Backup+Verify 26 h, PC Backup 48 h.

### Woher die Zahlen kommen – und was es kostet

| Quelle | zusätzlicher DB-Traffic |
|---|---|
| `data.flows`, `data.heartbeats`, `data.backup` aus dem Leitstand-Schnappschuss (wird bei offenem LIVE-Tab ohnehin alle 30 s geladen) | 0 |
| Realtime Broadcast (Websocket, kein Postgres) | 0 |
| Überwachungsläufe aus dem letzten Prüflauf im Speicher (`state.lastRun` / Verlauf) | 0 |

Das Modul selbst macht keine einzige REST-Abfrage (per Test abgesichert).

### Geänderte Dateien

| Datei | Änderung |
|---|---|
| `js/datenfluss.js` | neu |
| `js/leitstand.js` | 1 Import, `renderDatenfluss(data,laufzeit)` in `render()`, Runtime-Referenz (3 Zeilen) |
| `tests/datenfluss.test.js` | neu, 5 Tests |
| `version.json`, `sw.js`, `js/updater.js`, `js/kicc-heartbeat.js` | 0.7.29 → 0.7.30 |
| `supabase/functions/kc-system-check/index.ts` | Schritt A (Backup-Alter / gekoppelt-aber-stumm) |

Kein bestehender Code wurde umgeschrieben; die bisherige Liste „Datenflüsse" bleibt als Detailansicht unter der Karte.

## Geprüft

- **Testsuite:** 214/214 grün (`node --test tests/*.test.js`), davon 5 neue.
- **Echt gerendert** (Chromium, Desktop 1100 px + Handy 390 px) mit einem nachgestellten Leitstand-Schnappschuss (Heartbeats kc-dp2 + system-check, zwei Flow-Ereignisse, letzter Prüflauf mit der heutigen B2-Lage). Screenshots liegen bei. Keine Konsolenfehler. Kanten kc-dp2→Supabase und kc-manager→Supabase mit laufenden Punkten, PC Backup Vault in der Läufe-Karte rot/AUSGEBLIEBEN, Lebenszeichen OFFEN.
- Zwei-Spalten-Layout am Desktop (`desktop-layout.js`) übernimmt die neuen Karten ohne Anpassung.

## Nicht geprüft – ehrlich

- **Der Websocket zu Supabase Realtime** konnte aus meiner Umgebung nicht aufgebaut werden (kein Netz dorthin) – Badge zeigt in den Screenshots deshalb GETRENNT. Der Join-Handshake folgt dem Phoenix-Protokoll v1.0.0 mit `apikey` + `access_token` (anon), wie Supabase es erwartet. **Erster Praxistest:** LIVE-Tab öffnen, Badge muss auf LIVE springen. Falls „abgelehnt" erscheint, steht die Antwort des Servers im Badge-Tooltip nicht, sondern in der Konsole – dann bitte einmal melden, das wäre eine Realtime-Einstellung (Kanal-Autorisierung), keine Code-Frage.
- Solange kein Programm den Melder hat, kommen Kanten nur aus der bestehenden Flow-Telemetrie (`kicc_program_flow_events`). Das ist heute kc-dp2. Die Karte ist also erst mit Schritt B/2 (Melder im PC-Manager) richtig lebendig.

## Nächste Schritte (unverändert)

1. Schritt A deployen (Edge Function), SQL Lebenszeichen-Pflicht freigeben.
2. B/2: Melder in KC-Manager, Kassen-Verkehr im manager-companion zählen, Lebenszeichen.
3. B/3: `realtime.send()` in `kc_db_mirror_dispatch` (SQL zum Freigeben), danach PC-Manager als Pflicht.
