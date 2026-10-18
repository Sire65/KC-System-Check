# KC Traffic Guard – Server-Frühwarnung (16.10.2026)

## Zweck
Eigenständiger, passiver Schutz vor ungewöhnlich hoher Supabase-Datenbanklast. Laeuft in Supabase auch wenn KC Check und Club App geschlossen sind. Keine Aenderung an Kasse, Live-Ueberwachung, Neon-Spiegelung oder vorhandenem KC-Check-Alarmregelwerk.

## Produktivbestandteile
- Edge Function: \`kc-traffic-guard\` (GET = anonymes, minimiertes Statussignal; POST = geheimer Cron-Aufruf).
- PostgreSQL: \`kc_traffic_guard_samples\` (Messhistorie, Retention 7 Tage), \`kc_traffic_guard_alert_state\` (Deduplizierung).
- Funktionen: \`kc_traffic_guard_sample\`, \`kc_traffic_guard_status\`, \`kc_traffic_guard_verify\`, \`kc_traffic_guard_ack\`.
- Supabase Vault: \`kc_traffic_guard_cron\` (geheimes, zufaellig generiertes Token; nicht in GitHub).
- Cron: \`kc-traffic-guard-15m\` zu Minute 03, 18, 33, 48.
- Push: vorhandenes KC Communicator-Programm \`kc-system-check\`, Regeln \`system_warning\` und \`system_error\`, Admin-Empfaengergruppe und Club-App-Pushgeraete.
- Anzeigen: \`js/traffic-guard-ui.js\` in KC Check und \`kc-traffic-guard-ui.js\` im geschuetzten Club-Adminbereich. Die Club-Startseite zeigt nur bei Warnung und nur dem Admin einen Hinweis.

## Messung und Alarm
\`pg_stat_statements.calls\` liefert kumulierte SQL-Abfragen. Differenzen auf je 15 Minuten skaliert, mit gleitendem Durchschnitt der vorigen 24 h verglichen. Erste Messung = unknown. Bei Statistik-Reset oder ungueltigem Abstand = unknown statt Gruen.
- GELB: >= 10.000 Calls/15 min, oder >= 4.000 und >= 2,5-facher Vergleichswert.
- ROT: >= 20.000 Calls/15 min, oder >= 9.000 und >= 3-facher Vergleichswert.
- GELB-Push nach zwei aufeinanderfolgenden auffaelligen Messungen; ROT sofort. Dedupe und Bestaetigung nach erfolgreicher KC-Communicator-Uebergabe. Erneute ROT-Meldung nach hoechstens 6 Stunden.
- Ausfall/Stale > 50 min wird als unknown angezeigt, niemals als OK.
- Vorhandene Benachrichtigungsregeln fuer Push/E-Mail werden weiter genutzt; keine zweite VAPID-Infrastruktur.

## Entscheidende Grenze
**Kein offizieller Supabase-Egress-Messer!** Anzahl der SQL-Abfragen ist weder Antwortgroesse noch Egress. 5 GB Free-Plan-Kontingent gilt fuer die Summe der Projekte und schliesst Auth, Storage, Database, Functions etc. ein. \`billing_egress_gb:null\` bleibt absichtlich leer, bis eine dokumentierte, authentisierte, organisationsweite Abrechnungs-API verfuegbar und geprueft ist. Niemals SQL-Aufrufzahlen als GB oder als 5-GB-Prognose darstellen.
Offizielle Pruefung: https://supabase.com/dashboard/org/_/usage#egress

## Technische Tests
- Migrationen nur additiv, RLS fuer technische Tabellen an, API-Zugriff nur service_role, Cron-Token im Vault.
- GET liefert HTTP 200 mit \`level\`, \`measured_at\`, \`is_billing_egress:false\`, ohne Geheimnisse.
- POST ohne gueltiges 64-stelliges geheimes Token HTTP 401/403.
- Test Cron-Lauf 16.10.2026 20:33 UTC: succeeded; Status normal; keine Fehlalarm-Push.
- Vorhandene Club-Pushroute hat gespeicherte \`displayed\`-Quittungen. Der neue Push wurde nicht kuenstlich als Rot/Gelb ausgeloest.

## Rollback
- Cron \`kc-traffic-guard-15m\` gezielt deaktivieren, dann neue UI-Skripte aus den Indices entfernen, ggf. Edge Function \`kc-traffic-guard\` deaktivieren. Die vorhandenen KC-Check- und Club-Funktionen NICHT zuruecksetzen.

## Ausbau v2 (16.10.2026)
- Neu: `kc_traffic_guard_row_samples`, `kc_traffic_guard_row_alert`, `kc_traffic_guard_row_sample()`, `kc_traffic_guard_row_status()`, `kc_traffic_guard_row_ack()`.
- Die Spalte `pg_stat_statements.rows` ist ein Indikator fuer die Anzahl verarbeiteter bzw. zurueckgemeldeter SQL-Ergebniszeilen. Sie ist keine Byte-Messung, kein PostgREST-Egress und keine Abrechnungszahl.
- Gelb: >=65.000 Zeilen / 15 Min. oder mindestens 15.000 und mindestens 3x vorherige 24h-Basis.
- Rot: >=150.000 Zeilen / 15 Min. oder mindestens 35.000 und mindestens 5x vorherige 24h-Basis.
- Gelb erst nach 2 auffaelligen Messungen. Rot sofort, Wiederholung hoechstens alle 6 Stunden; bei erfolgreichem Versand quittiert. Zusammenfassung beider Alarm-Signale in maximal einer KC-Communicator-Nachricht je Prueflauf.
- Neue SQL-Zeilenmessung muss erst zwei Messpunkte im gueltigen Abstand haben, bis sie vom Zustand unknown auf normal oder Warnung wechselt.
- UI in KC Check und Club Admin zeigt SQL-Aufrufe/15 Min und Ergebniszeilen/15 Min getrennt.
- Externer GitHub-Workflow `.github/workflows/traffic-guard-external.yml` prueft stuendlich, ob der Guard erreichbar ist und ob beide Messpunkte juenger als 55 Min. sind. GitHub-Fehlschlaege allein sind keine garantierte Handy-Push-Zustellung, wenn Supabase selbst ausfaellt.
- Dokumentierte Supabase Management API `/v1/projects/{ref}/analytics/endpoints/usage.api-counts` meldet Anfragezahlen, nicht die fuer die 5-GB-Grenze erforderlichen gesamten Abrechnungs-Bytes.
- Fuer vollautomatische 5-GB-Prognosen muss zuerst eine zugaengliche und verifizierte organisationsweite Billing-Egress-Quelle fuer BEIDE Projekte angebunden werden. Bis dahin `billing_meter: not_configured` und keine Prozentanzeige.

## Ausbau v3 (18.10.2026) – Ursache und Push-Bremse fuer geplante Spitzen
- Neu: `kc_traffic_guard_ursache()` ordnet eine auffaellige Messung bekannten Ereignissen im Messfenster zu: Neubau Notfall-Paket (Protokoll `notpaket_gebaut` mit gemessenen DB-Abfragen), App-Starts nach neuer Version, Datensicherungslaeufe, Tageswechsel. Schaetzt den erklaerten Anteil der Mehrlast (1 REST-Abfrage ≈ 2 SQL-Aufrufe; App-Start ≈ 140). Ohne Treffer: „Ursache unbekannt – bitte pruefen“ mit den haeufigsten Club-Aktionen.
- Neu: `kc_traffic_guard_ursache_merken(sample, row_sample)` – von der Edge Function nur bei Gelb/Rot aufgerufen; speichert Ursache (Spalte `ursache`) und haengt sie an den Hinweistext und den Push.
- Push-Bremse: GELB zaehlt nicht fuer „zwei in Folge“, wenn diese oder die vorige Messung eine geplante Ursache hat. ROT wird nur dann nicht gepusht, wenn die geplante Ursache >= 80 % der Mehrlast erklaert UND < 40.000 SQL-Aufrufe / 15 Min. Ergebniszeilen-ROT wird nie gebremst. Faellt der Ursachen-Schritt aus, gilt das alte Verhalten.
- Status (GET) liefert zusaetzlich `geplant`. Messung, Schwellen und Quittierung unveraendert; die Messfunktionen selbst wurden nicht geaendert.
- Pruefung an echten Daten 16.–18.10.: 13:18 Gelb → Notfall-Paket (92 %), kein Push; 10:03 Gelb → App-Starts nach neuer Version, kein Push; 09:33 Rot → 2 erzwungene Neubauten + App-Starts (77 %), Push mit Ursache.
- Rueckweg: Edge Function auf v2-Stand (Commit vor v3) zuruecksetzen; die neuen Spalten/Funktionen stoeren dann nicht.
