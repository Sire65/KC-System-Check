# KC Infrastruktur – Vollständiger Diagnose- und Übergabebericht für Claude
**Prüfdatum:** Sonntag, 18.10.2026, Vormittag (Deutschland, MESZ = UTC+2)  
**Status:** BESTANDSAUFNAHME, keine Änderungen durchgeführt  
**Arbeitsauftrag:** Bitte zunächst nur lesen, Befunde reproduzieren und Optimierungen vorschlagen. Keine produktiven Daten, Sicherungen, Cron-Aufträge, Kassen-, Failover- oder Push-Funktionen ohne gesonderte Freigabe ändern.  
**Quelle:** Live-Abfragen der verbundenen Supabase-/Neon-Systeme, Supabase-Edge-Logs, GitHub-Actions-Protokolle und vorhandener Code in den KC-Repositories. Werte sind Momentaufnahmen, keine zugesicherte Dauermessung.

## 1. Zusammenfassung für die Weiterbearbeitung

- Beide Supabase-Projekte sind nach der Projekt-API im Zustand ACTIVE_HEALTHY. Die Organisation läuft auf dem Free-Tarif.
- Der neu gebaute **KC Traffic Guard (v2)** funktioniert: serverseitiger Cron alle 15 Minuten, Messung von SQL-Aufrufen und SQL-Ergebniszeilen, Benachrichtigung über KC Communicator (Push/E-Mail), Anzeige in KC Check und im Adminbereich von KC Club.
- **Last ist zum Ende der Prüfung normal.** Jüngste Messung: 18.10.2026, 07:03 Uhr MESZ: 4.019 SQL-Aufrufe/15 Minuten und 6.989 Ergebniszeilen/15 Minuten, beide normal.
- Es bestehen **kurzzeitige und teils kritische Spitzen**, oft rund um geplante Viertelstunden-/Stundenjobs. 11 Minuten mit mindestens 1.000 Edge-Anfragen verursachten zusammen 38.937 von 110.459 protokollierten Edge-Anfragen im untersuchten Hauptprojekt-24h-Fenster (~35,3 %). Diese Anfragen sind **nicht gleich** abgerechnete Egress-Bytes.
- **Wahrscheinlich wichtigster Burst-Auslöser:** KC Clubs serverseitiger Notfallpaket-Aufbau (pro Mitglied viele Datenbankabfragen). Dies ist sehr gut durch Zeitraster, Tabellenmuster und Quellcode gestützt, aber die konkrete Aktion ist im üblichen Edge-Log nicht für jede Anfrage vollständig ausgewiesen: **noch keine mathematisch eindeutige Zuordnung**.
- Zweiter untersuchungswürdiger Block: Neon-Spiegelungs- und Backup-Vorgänge, besonders um 20:00 Uhr MESZ.
- **Dringende offene Störung:** KC System Check meldete am 18.10.2026 um 07:00 Uhr MESZ einen fehlgeschlagenen Supabase→Neon-Rücklesetest mit dem Befund "restore-read test failed". Um 07:15 Uhr MESZ wurde für das Signal "mirror" weiterhin **confirmed=critical**, zugleich aber **candidate=healthy** gemessen: eine mögliche Erholung, noch keine bestätigte Entwarnung. Nicht als endgültig behoben einstufen.
- **Nicht vorhanden:** Automatischer, verifizierter Messwert für das von Supabase **abgerechnete organisationsweite Egress-Volumen**. Der Traffic Guard erfasst SQL-Lastindikatoren, nicht GB. Eine 5-GB- bzw. Free-Kontingent-Prognose darf daraus nicht konstruiert werden.

## 2. Betroffene Projekte und Repositories

| System | Referenz | Prüfresultat |
|---|---|---|
| Supabase Hauptprojekt | ptblnpiroqftcvlsrhac | ACTIVE_HEALTHY |
| Supabase Future Academy | iddudrxuihdodnvejxcp | ACTIVE_HEALTHY |
| KC Check Code | https://github.com/Sire65/KC-System-Check | Eigener Traffic Guard, Checks, Alarmregeln |
| KC Club App Code | https://github.com/Sire65/KC-Clubapp | Notfallpakete, Admin-Anzeige, Push |
| KC Verwaltung | https://github.com/Sire65/KC-Verwaltung | Frühere Synchronisations-Abfrageschleife; Korrektur im aktuellen Code festgestellt |
| PC Manager | https://github.com/Sire65/Kasse/tree/main/pc-manager | Vorher geprüft; kein vergleichbarer Auslöser nachgewiesen |
| Neon KC Core Mirror | Projektname im Neon-Konto, keine Zugangsdaten im Bericht | Spiegelungsziel |
| Neon KC Archiv Kopie | Separates Neon-Projekt | Separater Archivzweig |
| Neon PC Backup Vault | Separates Neon-Projekt | Separater Backup-Zweig |

**Sicherheit:** Keine API-Tokens, Passwörter, privaten Schlüssel, Mitgliederdaten oder Verbindungszeichenfolgen in diesen Bericht aufnehmen oder in Git veröffentlichen. Dieses GitHub-Repository ist öffentlich.

## 3. Lastbilanz – untersuchtes 24-Stunden-Fenster

**Fenster der Logabfrage:** 17.10.2026 05:00 UTC bis 18.10.2026 05:00 UTC = 17.10. 07:00 MESZ bis 18.10. 07:00 MESZ.

| Metrik | Hauptprojekt | Future Academy |
|---|---:|---:|
| protokollierte Edge-Logeinträge | 110.459 | 650 |
| Funktions-Edge-Logeinträge | 6.220 | 378 |
| Postgres-Logeinträge | 16.624 | 1.153 |
| HTTP 200 (Hauptprojekt) | 99.620 | – |
| HTTP 204 (Hauptprojekt) | 7.670 | – |
| HTTP 201 (Hauptprojekt) | 2.813 | – |
| HTTP 403 (Hauptprojekt) | 94 | – |
| HTTP 400 (Hauptprojekt) | 40 | – |
| HTTP 409 (Hauptprojekt) | 19 | – |

*Hinweis:* Quellen zählen Logeinträge/Requests und sind weder individuelle SQL-Statements noch direkt in GB umrechenbar. Von den 94 HTTP-403-Ereignissen waren 94 unter /auth/v1/user protokolliert. Das deutet auf abgewiesene Auth-Abfragen, **belegt allein aber keinen Sicherheitsangriff**. 19 HTTP-409-Zugriffe bei /rest/v1/kc_communication_requests gesondert bei Bedarf untersuchen.

### 3.1 Meistaufgerufene REST-Endpunkte im Hauptprojekt

| Endpunkt | protokollierte Zugriffe |
|---|---:|
| /rest/v1/kc_club_person_einstellung | 8.780 |
| /rest/v1/kc_core_people | 5.976 |
| /rest/v1/kc_live_operations_state | 5.542 |
| /rest/v1/kc_communication_requests | 3.794 |
| /rest/v1/kc_db_mirror_runs | 3.759 |
| /rest/v1/kc_communication_thread_participants | 3.476 |
| /rest/v1/kc_club_protokoll | 3.371 |
| /rest/v1/rpc/kc_club_anmeldung | 2.790 |
| /rest/v1/kc_club_gruppen | 1.817 |
| /rest/v1/kc_club_freigaben | 1.810 |
| /rest/v1/kc_club_zugang | 1.794 |
| /rest/v1/kc_communication_messages | 1.684 |

### 3.2 Auffällige Funktionsaufrufe

| Edge Function | 24h-Aufrufe im Funktions-Edge-Log |
|---|---:|
| /functions/v1/kc-club | 3.250 |
| /functions/v1/kc-live-operations-watch | 676 |
| /functions/v1/kc-termine | 669 |
| /functions/v1/kicc-program-heartbeat | 342 |
| /functions/v1/kc-system-check | 271 |
| /functions/v1/kc-traffic-guard | 141 |
| /functions/v1/kc-communication-maintenance | 135 |
| /functions/v1/kc-db-mirror-worker | 63 (62× HTTP 200, 1× HTTP 503) |

**Lastspitzen:** 11 einzelne Minuten mit mindestens 1.000 protokollierten Edge-Requests, darin insgesamt 38.937 von 110.459 Requests (~35,3 %). Größte gemessene Einzelminute: 5.354 Requests.

Beispiele aus den Logfenstern (alle Zeiten MESZ):

| 17./18. Oktober | Edge-Requests in einer Minute |
|---|---:|
| 17.10., 10:30 Uhr | 5.091 |
| 17.10., 11:45 Uhr | 4.708 |
| 17.10., 14:30 Uhr | 4.820 |
| 17.10., 15:45 Uhr | 5.354 |
| 17.10., 20:00 Uhr | 5.101 |
| 18.10., 00:00 Uhr | 4.678 |

Der 00:00-Uhr-Burst ist wiederkehrend: Vorherige lokale Mitternächte zeigten etwa 4.339 bzw. 4.506 Requests pro Minute. Bitte nicht auf normale Club-Nutzeraktivität schließen, bevor die automatischen Paketerstellungen geprüft sind.

## 4. KC Traffic Guard – Wirksamkeit und offene Grenzen

**Implementierung:**
- KC Check Repo: supabase/functions/kc-traffic-guard/index.ts
- SQL: supabase/migrations/202610162155_kc_traffic_guard.sql und 202610162245_kc_traffic_guard_rows.sql (zusätzliche Sampler-Migration im Repo)
- Dokumentation: docs/KC_TRAFFIC_GUARD.md
- GUI KC Check: js/traffic-guard-ui.js
- GUI KC Club: kc-traffic-guard-ui.js
- SQL-Historien: public.kc_traffic_guard_samples und public.kc_traffic_guard_row_samples
- Cron: kc-traffic-guard-15m zu Minute 03, 18, 33, 48
- Geschützte POST-Abfrage mit Token aus Supabase Vault, GET zeigt reduzierten Status; kein Login-/Mitgliederdatenabfluss.
- Alarmroute: bestehender KC Communicator, system_warning bzw. system_error, Push und E-Mail.
- GitHub: .github/workflows/traffic-guard-external.yml als zusätzlicher externer Healthcheck.

**Cron-Zuverlässigkeit:** In den abgefragten letzten 24 Stunden je 96 von 96 Starts erfolgreich für
- kc-traffic-guard-15m
- kc-club-notpaket-15min
- kc-club-wartung-15min
- kc-system-check-auto-15m

**SQL-Aufruf-Sampler:**
- Jüngste Messung 18.10. 07:03 MESZ: 4.019 Aufrufe / 15 Min., Level normal.
- Vorherige 06:48 MESZ: 2.118 Aufrufe / 15 Min.
- In den zuletzt abgefragten 120 Messungen: 111 normal, 7 critical, 2 warning.
- Spitzenwert dieser Stichprobe: 16.990 SQL-Aufrufe/15 Min.
- Kritische Beispielmessungen am 17.10. 10:33, 11:33, 11:48, 14:33, 15:48, 20:03 MESZ sowie am 18.10. 00:03 MESZ.

**Ergebniszeilen-Sampler:**
- Jüngste Messung 18.10. 07:03 MESZ: 6.989 Ergebniszeilen / 15 Min., Level normal.
- In den zuletzt abgefragten 120 Messungen: 113 normal und 7 warning.
- Höchste dokumentierte Auffälligkeit in diesem Prüfblock: 20.868 Ergebniszeilen/15 Min. (18.10. 03:03 MESZ).
- Misst über pg_stat_statements.rows, **keine Byte-Mengen**.

**Alarmzustand und Zustellung:**
- Zustellhistorie enthält mehrere erfolgreich angenommene/alarmierte Pushs mit Status "displayed" und E-Mails mit Status "sent", zuletzt Traffic-Guard-Alarm am 18.10. 00:03 MESZ.
- Alarm-Deduplizierung vorhanden; grüne Messungen setzen Alarmlevel zurück.
- Externe GitHub-Healthcheck-Läufe waren im abgefragten Verlauf erfolgreich, aber der GitHub-Schedule startet nicht immer exakt stündlich. GitHub-Action-Fehler garantieren keinen Smartphone-Push bei komplettem Supabase-Ausfall.
- **Anmerkung:** Zusätzlich kam am 18.10. 07:00 MESZ eine separate kritische Push-/E-Mail-Meldung von KC System Check wegen eines Backup-Rücklesefehlers (nicht Traffic Guard).

**Grenze:** Die offiziellen, organisationsweit abgerechneten Supabase-Egress-GB (Hauptprojekt plus Academy; Database, Storage, Functions, Auth usw.) sind weiterhin nicht an eine verifizierte Abrechnungs-API angebunden. Deshalb darf die App **keine unbestätigte Verbrauchsprozentzahl oder Kontingentprognose anzeigen**. Bitte nur mit dokumentierter und verifizierter Quelle weiterentwickeln. Früheres Supabase-Dashboard warnte vor einer Free-Kontingentüberschreitung und möglichen Einschränkungen ab 16.11.2026.

## 5. KC Club – Notfallpaket als wahrscheinlicher Lastverursacher

**Codebefund in produktiver Edge Function kc-club:**
- pg_cron: kc-club-notpaket-15min läuft alle 15 Minuten.
- Aktion "notpaket" ruft notpaketLauf() und notpaketBauen() auf.
- Teilpakete werden mit "notpaket_teil" je berechtigtem Mitglied erzeugt.
- Maximal vier Teilpakete parallel (NOT_PARALLEL = 4).
- notpaketMitglied() ruft zahlreiche interne Aktionen/Datenbank-Tabellen ab; dazu zählen persönliche Einstellungen, Chats, Kommunikations-Teilnehmer, Gruppen und Rollen.
- Code enthält eine bereits bestehende 1-Stunden-Bremse für vollständige Neubauten bei geändertem Fingerabdruck und Wiederverwendung, wenn nichts verändert ist. Bitte **prüfen**, ob dieses Verhalten korrekt und konsistent greift; nicht ohne Messung umbauen.

**Aktueller Notfallpaket-Stand:**
- Zuletzt vollständig hochgeladen: 18.10.2026 00:00:03 MESZ.
- Bestätigung: 18.10.2026 07:00:04 MESZ.
- Mitglieder: 17.
- Dauer des letzten Paket-Neubaus: 30.199 ms.
- Größe des komprimierten Pakets: 162.843 Bytes.
- Im abgefragten Status kein aktueller Fehlertext.
- Auftrag kc-club-notpaket-15min: 96/96 Cron-Starts in 24h erfolgreich (Cron-Erfolg ist nicht zwangsläufig Gleichbedeutung mit erfolgreichem Neubau jedes einzelnen Pakets).

**Evidenz:** Rund um Mitternacht 17 interne kc-club-Funktionsaufrufe, mehrere Tausend PostgREST-Zugriffe und das charakteristische Tabellenmuster. Ursache daher **hochplausibel, aber ohne per-Request-Aktionsfeld nicht abschließend bewiesen**.

**Schutzanforderung:** Notbetrieb bei Supabase-Ausfall, Vollständigkeit aller Mitglieder, Signatur/Prüfsummen, Rücklesbarkeit, automatischer Nachtrag und Schutz gegen halbfertige Pakete müssen erhalten bleiben. Keine Abschaltung oder Reduzierung der Schutzabdeckung. Optimierungsideen zunächst messen: Batch-Abfragen, unveränderte Teilpakete wiederverwenden, Deltas statt Vollabgleich, harte Obergrenzen sowie Entzerrung der Startzeiten. Vorher ein konkretes Mess- und Regressionskonzept vorlegen.

## 6. Supabase → Neon / Backup – derzeit höchste Priorität

**Alarm aus KC System Check am 18.10.2026 um 07:00 MESZ:**
> KC System Check meldet ROT. Spiegelung · Supabase → Neon: Backup [ID intern im System] : restore-read test failed · vor 20 min · letzter Lauf danach vor 20 min

Die vollständige Sicherungs-ID bitte nur im nichtöffentlichen System prüfen, nicht im öffentlichen Bericht verbreiten.

**Bestätigte Logdaten:**
- Edge Function kc-db-backup-verify-v2 am 18.10.2026 06:40 MESZ: mindestens ein HTTP 500; außerdem HTTP-200-Antworten. **HTTP 200 belegt nicht automatisch das Ergebnis des Rücklesetests.**
- Edge Function kc-db-mirror-worker am 18.10.2026 02:10 MESZ: einmal HTTP 503, danach weitere HTTP 200, jüngster protokollierter Erfolg um 07:05 MESZ.
- KC-System-Check-Alarmstatus um 18.10. 07:00 MESZ: Signal "mirror" confirmed=critical.
- Erneuter Status um 18.10. 07:15 MESZ: "mirror" weiterhin **confirmed=critical**, aber "candidate=healthy". Es kann auf Genesung hindeuten; bitte nicht als bestätigt behoben melden.
- Andere Statussignale 07:15 MESZ: "backup_neon_ffm" healthy; "b2" zuvor healthy; "backup" unknown; "db_security" warning (älterer Befund); "db_capacity" healthy.
- Neon-Account enthält Projekte "KC Core Mirror", "KC Archiv Kopie" und "PC Backup Vault"; diese nicht miteinander verwechseln. Das KC Core Mirror-Projekt war zuletzt aktiv.

**Unbedingt prüfen, nur lesend beginnen:**
1. Betroffene Sicherung, zugehörige Run-ID und Fehlerdetails in den privaten Spiegelungs-/Backup-Protokollen ermitteln.
2. Unterschied zwischen "Backup erstellt", "Neon synchron", "Prüfsumme stimmt" und "Restore-Read erfolgreich" strikt trennen.
3. Bestehen neuere **nachweislich erfolgreich zurückgelesene** Sicherungen? Wenn nein, Alarm beibehalten.
4. Ursache HTTP 500 vom Verify-Worker und HTTP 503 vom Mirror-Worker anhand Logs, Timeout, Schema-/RLS-/Auth-Fehlern und Abhängigkeiten diagnostizieren.
5. Backup/Spiegelung oder Cron niemals vorsorglich deaktivieren; keine produktiven Daten überschreiben, keinen Restore ins Live-System ausführen.
6. Vor Reparatur: reproduzierbarer Testplan, Risikoanalyse und Rollback.

## 7. Sonstige Auffälligkeiten

- Das Club-App-GitHub-Workflow "Datenbank einspielen" schlug am 18.10.2026 06:04 MESZ **im Modus "pruefen"** für die Migration zur Wunschliste mit "nicht berechtigt" fehl. Dies ist ein separat zu analysierendes Berechtigungs-/Testumgebungsproblem. **Nicht annehmen, dass die Migration angewendet wurde.** Spätere Club-App-Tests, Server-Uploads und Pages-Veröffentlichungen liefen erfolgreich.
- HTTP 403 auf /auth/v1/user: 94 protokollierte Ereignisse/24h. Bei Bedarf Auswirkung veralteter Auth-Tokens/Sitzungen eingrenzen, keine pauschalen Policy-Änderungen vornehmen.
- HTTP 409 auf /rest/v1/kc_communication_requests: 19. Idempotenz/Mehrfachzustellung prüfen, aber Konflikte können beabsichtigt sein.
- "db_security" steht noch auf warning, weitere Einzelbefunde müssen anhand KC-Check-Details geprüft werden.
- Die Academy hat im selben Zeitfenster nur 650 protokollierte Edge-Anfragen gegenüber 110.459 im Hauptprojekt; sie ist voraussichtlich nicht der Hauptauslöser der beobachteten Lastspitzen.
- PC Manager und KC Verwaltung waren zuvor separat lesend geprüft. Der Manager hatte keine entsprechende Dauerlast; die früher bekannten vollständigen KC-Verwaltungs-Cloud-Abgleichschleifen wurden im aktuellen Code gedrosselt. Diese Aussage betrifft Code/Protokolle, **nicht die Installation auf einem bestimmten PC**.

## 8. Arbeitsauftrag an Claude – priorisiert

**A. Sicherheitsrelevanter Fehler zuerst:** Restore-Read-Fehler der Supabase→Neon-Kette fachlich nachvollziehen. Nachweisdaten über mindestens einen tatsächlich rücklesbaren jüngeren Backup-Stand liefern. Ursache, Reparaturvorschlag, Risiken und erforderliche Regression dokumentieren.

**B. Lastursache nachweisen:** Einmaliges, sparsames und datenschutzkonformes Tracing für die Aktionen notpaket / notpaket_teil, einschließlich Start/Ende, Abrufzahl, Dauer, grober Antwortgröße und Grund für Neubau ("Fingerabdruck geändert", "erzwungen" etc.) konzipieren. Keine sensiblen Nutzinhalte loggen. Die 11 Kurzspitzen dem jeweiligen Job zuordnen (Notpaket, Spiegelung, echte Nutzerlast, Tests).

**C. Effizienter machen, ohne Sicherheitsverlust:** Auf vorhandene Stundendrosselung und unveränderte Pakete aufsetzen; keine zweite parallele Sicherheitslösung. Vorschläge für Batching, Teilwiederverwendung und entzerrte Cron-Starts ausarbeiten; vollständige Regression für Notbetrieb, nachträgliches Einspielen und Backup-Wiederherstellung vorsehen.

**D. Traffic Guard vervollständigen:** Offizielle Egress-Quelle für beide Projekte und Cache-Egress klären; bis dahin Anzeige ausdrücklich "nicht angebunden". Zusätzlich externe GitHub-Healthchecks und deren Ausfallalarm unabhängig vom Supabase-Kommunikationsweg konzipieren; Alarmflut durch bekannte geplante Last NICHT einfach stumm schalten.

**E. Nebenbefunde:** Fehlgeschlagenen Wunschlisten-Migrations-Probelauf, alten db_security-Warnzustand, Auth-403 und Comms-409 separat bewerten.

### Für die Rückmeldung gewünscht

Bitte als erstes liefern:
1. Ursachenmatrix **bestätigt / hochplausibel / noch offen** mit genauem Beleg.
2. Kleinste mögliche Änderungen mit Angabe der betroffenen Dateien/SQL-Funktionen/Cron-Aufträge.
3. Konkrete Regressionstests, Messkriterien und Rollbackplan.
4. Risiken für Notbetrieb, Supabase→Neon, Push, Kasse und normale Club-Mitglieder.
5. Auflistung, was **nicht** verändert werden muss.

**Wichtig:** Bis zur ausdrücklichen Freigabe durch den Auftraggeber nur lesen, keine produktiven Deployments, SQL-Mutationen oder Cron-Änderungen. Die Untersuchung, aus der dieser Bericht entstand, war read-only.

## 9. Hilfreiche vorhandene Quellen

- KC Traffic Guard Konzept und Grenzen: https://github.com/Sire65/KC-System-Check/blob/main/docs/KC_TRAFFIC_GUARD.md
- Traffic-Guard-Serverfunktion: https://github.com/Sire65/KC-System-Check/blob/main/supabase/functions/kc-traffic-guard/index.ts
- Club-App-Code: https://github.com/Sire65/KC-Clubapp
- Erfolgreicher KC-Check-Testlauf: https://github.com/Sire65/KC-System-Check/actions/runs/38965143096
- GitHub-Watchdog-Beispiel: https://github.com/Sire65/KC-System-Check/actions/runs/39085726879
- Fehlgeschlagener Club-Wunschlisten-Probelauf: https://github.com/Sire65/KC-Clubapp/actions/runs/39095821858
- Offizielle Supabase-Verbrauchsansicht (Login erforderlich): https://supabase.com/dashboard/org/_/usage

**Ende des Übergabeberichts.**