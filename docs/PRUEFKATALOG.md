# Pruefkatalog

Jede Pruefung liefert denselben Datensatz: `id`, `name`, `kind`, `status`,
`health`, `latency`, `usage`, `capacityLabel`, `detail`, `metrics`.
`status` ist `healthy`, `warning`, `critical`, `unknown` oder
`not_configured`. **Nur `healthy`, `warning` und `critical` zaehlen in
Gesamtwert und Pruefabdeckung** - alles andere bleibt ausdruecklich
unbewertet und wird nie als gesund dargestellt.

## Bestehend

| id | prueft | Schwelle |
|----|--------|----------|
| `kc_core` | Erreichbarkeit und Antwortzeit KC Core, Datenbankgroesse | > 3000 ms gelb, nicht erreichbar rot |
| `future_academy` | Erreichbarkeit Future Academy, Datenbankgroesse | > 3000 ms gelb |
| `mirror` | Spiegelung Supabase → Neon | Abweichung rot, Lauf > 180 min gelb, kein Lauf unbekannt |
| `neon`, `b2`, `r2`, `oci` | Read-only-Status bzw. Backup-Telemetrie | ohne Zugang `not_configured` |
| `github` | Repository erreichbar, Sichtbarkeit | oeffentlich oder archiviert gelb |

## Neu in 0.7.1

| id | prueft | Schwelle |
|----|--------|----------|
| `db_security` | Tabellen ohne RLS, Views die RLS umgehen, **ungedeckte** Rechte fuer `anon`/`authenticated`, Policies mit `using(true)` | ungedeckter Zugriff rot, offene Lese-Policy gelb |
| `db_capacity` | Verbindungen gegen `max_connections`, groesste Tabellen, Sequenzausschoepfung, Vacuum-Rueckstand | ≥ 90 % Verbindungen oder Sequenz > 70 % rot, ≥ 70 % Verbindungen oder Vacuum-Rueckstand gelb |
| `endpoint_exposure` | Antwortet die Prüf-API oder der Leitstand ohne Anmeldung? | alles ausser 401/403 rot |
| `key_lifetime` | Restlaufzeit und Gesamtlaufzeit des oeffentlichen Schluessels | < 30 Tage rot, < 90 Tage oder > 5 Jahre Laufzeit gelb |

Ein Recht an `anon`/`authenticated` ist **kein** Befund, solange RLS oder
eine View mit `security_invoker=true` es deckt - Supabase vergibt diese
Rechte standardmaessig. Gemeldet wird nur, was durch nichts gedeckt ist:
Tabellen ohne RLS, Views mit Eigentuemerrechten und materialisierte
Views. Ohne diese Unterscheidung meldete die erste Fassung 244 harmlose
Rechte und waere dauerhaft rot gewesen.

Alle vier lesen ausschliesslich Metadaten - keine Nutzdaten, keine
Schreibzugriffe, keine kostenpflichtigen Aufrufe. `db_security` und
`db_capacity` melden `not_configured`, solange die Migration nicht
eingespielt ist; sie faerben den Gesamtstatus dann nicht ein.

## Noch offen aus der Bestandsaufnahme

Schema-Drift zwischen Supabase und Neon, inhaltliche Pruefsummen statt
Zeilenzahlen, Restore-Drill, Zertifikatslaufzeiten, Auth-Anomalien,
synthetische Fachtransaktionen, Geraete- und Standorttelemetrie
(Akku, Netzqualitaet, Drucker, lokaler Speicher), ehrliche
Invocation-Zaehlung ueber alle Funktionen.

## Aufbewahrung und Kennzahlen

`kc_internal.kc_db_mirror_retention_cleanup()` loescht taeglich um 03:17
alle Spiegellaeufe aelter als 14 Tage - das haelt `kc_db_mirror_runs`
stabil bei rund 149 MB. Gemessen am 2026-09-06: Datenbank 209 von 500 MB,
in den zwei Tagen davor unveraendert. Die Datenbank waechst also **nicht**
unbegrenzt.

Verloren gingen dabei bisher aber alle Kennzahlen. Deshalb verdichtet
`public.kc_db_mirror_daily_rollup()` (taeglich 03:05, also *vor* dem
Aufraeumen) jeden abgeschlossenen Tag nach
`kc_db_mirror_runs_daily`: Anzahl Laeufe, auffaellige Laeufe,
Abweichungen, maximaler und mittlerer Replikationsverzug. Die Funktion
loescht selbst nichts - es gibt weiterhin genau einen Aufraeumer.

## Woher die Datenbankpruefungen kommen

Die Sicherheits- und die Kapazitaetspruefung stehen seit v0.7.12 nicht mehr als
SQL-Text in den KC-Funktionen, sondern in einem eigenstaendigen, tragbaren
Paket: `share/db-monitor/install.sql`. Es legt das Schema `db_monitor` mit drei
Funktionen an - `security_audit`, `capacity` und `report` - und laeuft auf jeder
PostgreSQL-Datenbank ab Version 13, auch ohne die Supabase-Rollen.

`kc_system_check_security_audit()` und `kc_system_check_db_capacity()` rufen es
seither nur noch auf. Ihre Felder heissen unveraendert, damit die Edge Function
gleich bleibt; einzig `uncovered_grants` traegt fuer KC weiter den alten Namen
`public_grants`.

Der Umbau hat zwei Fehler sichtbar gemacht, die in der doppelten Fassung nicht
auffielen:

- **Klammerfehler in `views_bypassing_rls`.** Es stand
  `where (relkind='v' and not invoker) or relkind='m' and exists (...)`. `and`
  bindet staerker als `or`, die Rechtepruefung galt also nur fuer
  materialisierte Views. Eine View mit Eigentuemerrechten, die niemand erreichen
  kann, wurde dadurch als Loch gemeldet.
- **Fehlende Typangabe im Hinweis-Zweig.** `hinweise || 'Text'` ohne `::text`
  bricht zur Laufzeit ab, weil PostgreSQL den Text fuer eine Array-Angabe haelt.
  Gefunden hat das erst der erste Lauf gegen die echte Datenbank; seither loest
  `tests/sql/db-monitor.test.sql` diesen Zweig gezielt aus.

Ein Test wacht darueber, dass Paket und Migration nicht auseinanderlaufen
(`tests/db-monitor-package.test.js`).

## Wo das Paket ueberall liegt

| Datenbank | Stand | Ergebnis beim Einspielen |
| --- | --- | --- |
| KC Core (Supabase, PostgreSQL 17) | Migration `202609060011` | gruen, keine Befunde |
| KC Core Mirror (Neon, PostgreSQL 18.6) | von Hand eingespielt am 2026-09-06 | gruen; 64 Tabellen ohne RLS, aber keine Client-Rolle vorhanden - deshalb Hinweis statt Alarm |

Auf Neon gibt es weder `anon` noch `authenticated` noch `service_role`. Die
Datei erkennt das und ueberspringt die entsprechenden Rechte. Genau dieser Fall
war der Grund fuer den Umbau: dieselbe Datei muss auf beiden Seiten laufen.

## Die Neon-Kachel

Seit v0.7.13 fragt der Server die Spiegeldatenbank selbst. Neon spricht SQL
ueber HTTP: eine POST-Anfrage auf `https://<host>/sql`, das Geheimnis im Kopf
`Neon-Connection-String`, nie in der Adresse. Kein Treiber, keine dauerhafte
Verbindung, eine Anfrage pro Lauf.

Die Kachel zeigt Belegung gegen das Neon-Freikontingent (512 MB), Verbindungen,
groesste Tabelle und alle Befunde aus `db_monitor.report()`. Antwortet Neon
nicht, ist das **rot** und nicht grau: ein Spiegel, den niemand erreicht,
erfuellt seinen Zweck nicht. Einzelne Aussetzer faengt die Entprellung der
Alarmregel ab. Ist gar kein Zugang hinterlegt, bleibt die bisherige,
vorbereitete Kachel stehen - das ist ehrlich grau, nicht gruen.

Der Zugang liegt in `kc_external_credentials` unter dem Namen `neon_mirror`,
lesbar ausschliesslich fuer service_role. Nicht in den Umgebungsvariablen der
Edge Function: in der Datenbank laesst er sich ohne neues Deploy austauschen und
vor allem abschalten.

### Was dabei nicht geht - nachgeprueft, nicht vermutet

Der hinterlegte Neon-Zugang ist **kein Lesezugang**. Auf Neon kann sich nur
anmelden, wer ueber die Neon-API angelegt wurde, und solche Rollen sind dort
immer Mitglied von `neon_superuser`. Der Versuch, per SQL eine Rolle mit nur
`execute` auf `db_monitor.report()` anzulegen, scheitert nicht an den Rechten,
sondern am Neon-Proxy: `password authentication failed`. Getestet mit beiden
Hostnamen, mit und ohne Pooler.

Was bleibt, ist die Trennung der Kennungen: `kc_monitor` ist nicht die Kennung
der Spiegelung. Faellt sie auf, laesst sie sich einzeln loeschen, ohne dass die
Spiegelung stehenbleibt.

## Die GitHub-Kachel: Eigenschaft oder Mangel

Bis v0.7.14 meldete die Kachel "Repository ist oeffentlich" als Dauerwarnung.
Damit stand sie gelb, seit es sie gibt, und der Gesamtzustand ebenfalls. Das
ist dieselbe Sorte Fehlalarm wie die 244 vermeintlich ungedeckten Rechte und
der vermeintliche Vacuum-Rueckstand: gemeldet wurde eine **Eigenschaft**, kein
Mangel.

Oeffentlich zu sein schadet nicht. Was schadet, ist ein Geheimnis in einer
weltweit lesbaren Datei. Genau das wird ab v0.7.15 geprueft, an der Datei, die
die App tatsaechlich mitliefert - `config/runtime.public.json` im Hauptzweig,
abgeleitet aus der API-Antwort und nicht fest eingetragen.

Gesucht wird nach Form, nicht nach Inhalt:

| Muster | warum |
| --- | --- |
| `sb_secret_...` | Supabase-Geheimschluessel im neuen Format |
| `service_role` im Klartext | der Dienstschluessel umgeht jede RLS |
| JWT, dessen Rumpf eine andere Rolle als `anon` traegt | im JWT steht die Rolle base64-kodiert und damit nicht im Klartext - der Rumpf wird entschluesselt |
| `schema://nutzer:passwort@host` | Verbindungszeichenkette mit Passwort |
| `-----BEGIN ... PRIVATE KEY-----` | privater Schluessel |

Ein Fund nennt nur seine Art. Der gefundene Wert taucht in keiner Antwort auf -
sonst stuende das Geheimnis anschliessend im Pruefverlauf, in der Push-Nachricht
und in der E-Mail. Ein eigener Test wacht darueber.

Die Zustaende:

- **rot** - ein Fund. Unabhaengig davon, ob das Repository oeffentlich ist: wer
  ein Geheimnis eincheckt, checkt es auch in ein privates Repository ein.
- **gelb** - Repository archiviert. Das ist ein echtes Betriebssignal.
- **grau (unknown)** - oeffentlich, aber die Datei war nicht abrufbar. Ungeprueft
  ist nicht gruen (Regel 11).
- **gruen** - nicht oeffentlich, oder oeffentlich und nichts gefunden. Im Text
  steht dann, dass das eine bewusste Entscheidung ist.

### Was das nicht leistet

Geprueft wird die Datei, die die App ausliefert - nicht jede Datei im
Repository und nicht der Verlauf. Vollstaendiges Durchsuchen nach Geheimnissen
ist GitHubs Aufgabe: Secret Scanning ist fuer oeffentliche Repositories
kostenlos und gehoert in den Repository-Einstellungen eingeschaltet. Diese
Pruefung ersetzt es nicht, sie deckt den Weg ab, auf dem ein Geheimnis hier
tatsaechlich nach draussen gelangen wuerde.

### Warum nicht privat schalten

Die App wird ueber GitHub Pages ausgeliefert. Pages aus einem privaten
Repository setzt einen bezahlten GitHub-Plan voraus - auf dem freien Plan
verschwindet damit die App. Das verstiesse gegen die Nulltarif-Regel und
beseitigt nichts: die Laufzeitkonfiguration wird von der veroeffentlichten App
ohnehin ausgeliefert, ob das Repository nun privat ist oder nicht.
