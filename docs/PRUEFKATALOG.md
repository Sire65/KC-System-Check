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

## Was die Oberflaeche nicht beschoenigen darf

Drei Stellen, an denen die App die Lage besser darstellte, als sie war. Alle
drei am 2026-09-06 an Bildschirmfotos aus dem Betrieb gefunden, alle drei mit
Zahlen aus der Datenbank belegt.

**1. Prueffabdeckung 100 % bei einer Auswahlpruefung.** Der Nenner war die
Auswahl, nicht die Zahl der bekannten Pruefungen. Zehn von zehn ausgewaehlten
sind 100 % - auch wenn vier Kacheln nie gelaufen sind, darunter die einzige mit
einem offenen Befund. Seit v0.7.25 ist der Nenner `all.length`, und die Antwort
traegt `selection` mit `known`, `run` und `skipped`; die Kopfzeile schreibt
"N von M Pruefungen nicht enthalten" dazu.

**2. "Aktuell keine Fehler oder Warnungen" bei 46 auffaelligen Laeufen.** Die
Befundliste zeigte nur den juengsten Lauf. War das eine Auswahlpruefung ohne die
auffaellige Kachel, stand dort Ruhe. Jetzt wird, wenn der juengste Lauf ohne
Befund bleibt, der juengste Lauf MIT Befund gezeigt - mit Uhrzeit - und darunter
die Bilanz der letzten 31 Tage.

**3. Der Verbrauch war bei 40 gedeckelt.** Er wurde im Browser aus der
Verlaufsliste gerechnet, und die holt nur die letzten 40 Laeufe. Tatsaechlich:
464 Laeufe, 1.08 MB Antwortdaten. Der Free-Tier-Anteil war um das Elffache zu
niedrig - genau die Richtung, in die eine Verbrauchsanzeige nicht irren darf.
Gezaehlt wird seit v0.7.25 in der Datenbank (`kc_system_check_usage()`).
Faellt die Zaehlung aus, steht dort ein Strich und kein geschaetzter Wert.

Dazu zwei Kleinigkeiten aus derselben Sitzung: die LIVE-Geraeteliste stellt
Aktive voran und legt alles Historische hinter einen Aufklapper (sie war eine
Halde aus 27 Sitzungen, davon zwei aktiv), und ein Knopf im Kopf laedt den
gesamten Stand als JSON-Datei herunter - Kennzahlen und Befunde, keine
Zugangsdaten.

## Die Programm-Kachel: wann gemeldet?

`kicc_program_heartbeats` haelt **eine Zeile je Browser-Sitzung**
(`program_id` + `instance_id`) und schreibt sie fort; die Kachel nimmt je
Programm die juengste. Ein selbst gemeldeter Fehlerzaehler beschreibt damit den
Endstand einer Sitzung - die auch seit Stunden vorbei sein kann.

Am 2026-09-06 stand deshalb "KC Dienstplan meldet 3 Fehler" in der Kachel,
gezaehlt um 05:24, gelesen um 11:50. Seit v0.7.23 steht das Alter dabei:
"KC Dienstplan (3, zuletzt vor 7 h)". Unter 90 Minuten in Minuten, darueber in
Stunden, ab zwei Tagen in Tagen; fehlt die Angabe, heisst es "Alter unbekannt"
und nicht "gerade eben".

**Was der Zaehler zaehlt, weiss nur das Programm.** Die aeltere Anbindung des
Dienstplans (`src/core/kicc-heartbeat.js`) zaehlt drei verschiedene Dinge in
einer Zahl: `window.error`, `unhandledrejection` **und fehlgeschlagene
Sendeversuche des Lebenszeichens selbst**. Ein Wert von 3 kann also heissen,
dass das Programm dreimal nicht senden konnte - ein Netzproblem, kein
Programmfehler. Das tragbare Paket in `share/heartbeat` macht das anders und
ueberlaesst die Zahl vollstaendig dem Programm.

## Die Spiegel-Kachel: welche Tabelle?

Ein Warnhinweis, der nicht sagt, worueber er warnt, kostet genau die Zeit, die
eine Ueberwachung sparen soll. Zwei Ausbaustufen:

* seit v0.7.20 liefert `kc_system_check_snapshot()` den juengsten auffaelligen
  Lauf mit - Tabelle, Meldung, Zeitpunkt.
* seit v0.7.21 nennt sie zusaetzlich die betroffenen Tabellen beim Namen.
  Noetig wurde das, weil die Sammelbefunde der Waechter ("35/36 Tabellen
  frisch") gar keine Tabelle tragen: sie pruefen den Gesamtzustand. Massstab
  ist derselbe wie dort - der juengste abgeschlossene Lauf einer Tabelle ist
  entweder nicht `ok` oder aelter als 65 Minuten. Hoechstens fuenf Namen.

Die Liste entsteht aus `kc_db_mirror_runs` selbst und nicht aus
`kc_db_mirror_table_rules`: eine fremde Umgebung fuehrt keine identischen
Nebentabellen.

**Der haeufigste Grund fuer eine Abweichung ist eine Schemaaenderung.** Die
Verifikation vergleicht ganze Zeilen als JSON. Kommt in der Quelle eine Spalte
dazu, gehen die Pruefsummen auseinander, bis der Spiegel dieselbe Spalte hat -
und der Spiegel zieht das **nicht** automatisch nach. Genau das passierte am
2026-09-06: drei neue Spalten in `kc_core_app_registry` um 10:44, Abweichung im
Lauf um 11:00, still um 11:30, nachdem die Spalten in Neon nachgezogen waren.

### Die Farbe folgt dem jetzigen Zustand

Bis v0.7.21 faerbte jeder nicht fehlerfreie Lauf der letzten 24 Stunden die
Kachel gelb (`non_ok_24h > 0`). Ein einziger Ausrutscher hielt sie damit einen
Tag lang gelb, auch wenn der naechste Lauf 15 Minuten spaeter wieder sauber war
- und eine Kachel, die aus Gewohnheit gelb steht, verdeckt den Tag darauf einen
echten Befund. Genau das drohte am 2026-09-06: behoben um 11:30, gelb bis zum
naechsten Vormittag.

Seit v0.7.22 entscheidet, ob **gerade** eine Tabelle haengt (`open_tables` aus
den `veraltete_tabellen` der Momentaufnahme). Behobene Befunde verschwinden
nicht, sie stehen als Zahl im Text: "3 behobene(r) Befund(e) in 24 h". Der
juengste Lauf selbst bleibt ausschlaggebend: ist er nicht `ok` oder meldet er
Abweichungen, ist die Kachel rot.

### Der Waechter fuehrte eine handgeschriebene Liste

`kc_internal.kc_db_mirror_watchdog()` hatte 36 Tabellennamen fest im Quelltext,
gespiegelt werden 48. Die zwoelf `kc_communication_*` kamen spaeter dazu und
standen nie darin. Ungeprueft waren sie nicht - der zweite Waechter
(`kc_db_mirror_source_check`, alle 15 Minuten) liest die Regeltabelle -, aber
eine zu kurze Liste meldet immer "alles frisch", und niemand merkt es.

Seit v0.7.22 (Migration 202609060022) liest der Waechter dieselbe Quelle wie
das Spiegeln selbst: `kc_db_mirror_table_rules` mit `mirror_enabled`. Eine neue
gespiegelte Tabelle ist ab dem ersten Lauf ueberwacht. Seine Meldung nennt jetzt
die betroffenen Tabellen (hoechstens fuenf), und eine leere Regeltabelle meldet
nicht mehr "0/0 frisch, alles gut" - wer nichts ueberwacht, hat nichts
bestaetigt.

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

## Die Sicherung

Seit v0.7.17 hat die taegliche Sicherung eine eigene Kachel. Vorher war sie im
Programm nicht sichtbar - nicht weil sie fehlte, sondern weil an der falschen
Stelle gesucht wurde: `kc_backup_machine_telemetry` in KC Core ist leer und
war es immer. Das ist die Telemetrie des Sicherungsrechners, nicht die
Datenbanksicherung.

Die Datenbanksicherung liegt in der Neon-Spiegeldatenbank, in eigenen Tabellen:

| Tabelle | Inhalt |
| --- | --- |
| `kc_backup_sets` | ein Satz je Lauf: Beginn, Abschluss, Status, Tabellen, Zeilen, Bytes |
| `kc_backup_snapshots` | die gesicherten Inhalte je Tabelle mit Pruefsumme |
| `kc_backup_verifications` | das Ergebnis der taeglichen Pruefung |

Zwei Zeitplaene fuellen sie: `kc-db-immutable-backup-daily` um 03:30 und
`kc-db-backup-verify-daily` um 04:00. Beide loesen ueber pg_net eine Anfrage an
den Sicherungsdienst aus. **Wichtig fuer das Verstaendnis der Luecke:** der
Zeitplan gilt als erfolgreich, sobald pg_net die Anfrage angenommen hat. Ob der
Dienst danach etwas geschrieben hat, erfaehrt er nie - und die Antwort von
pg_net wird nach wenigen Stunden geloescht. Der einzige dauerhafte Nachweis
steht in den Tabellen oben. Genau die liest die Kachel.

### Wie bewertet wird

Eine Sicherung ist erst dann eine Sicherung, wenn sie **frisch** ist UND
**geprueft**. Beides getrennt:

- **rot** - kein einziger erfolgreicher Satz; oder der letzte ist ueber 48 h
  alt; oder die Pruefung meldet einen anderen Status als ok; oder Tabellen
  haben die Pruefung nicht bestanden.
- **gelb** - der letzte Satz ist ueber 26 h alt (taeglich erwartet); oder es
  wurde nie geprueft; oder die letzte Pruefung ist ueber 48 h alt; oder ein
  Lauf haengt seit ueber zwei Stunden; oder der juengste Versuch schlug fehl,
  waehrend ein aelterer Satz gueltig ist.
- **grau** - der Zustand war nicht abrufbar. Ungeprueft ist nicht gruen.
- **gruen** - frisch und geprueft.

Ein frischer, aber ungepruefter Satz ist **gelb**, nicht gruen: eine
ungepruefte Sicherung ist eine Vermutung, keine Zusage.

**Nicht** gefaerbt wird von alten, nie abgeschlossenen Saetzen. In der
Produktion liegen ein `running` von vor neun Tagen und ein `error` von vor
neunzehn - Ueberbleibsel aus der Einrichtung. Sie stehen im Text, faerben aber
nichts; sonst stuende die Kachel fuer immer gelb. Dieselbe Entscheidung wie bei
den 244 Rechten, beim Vacuum-Rueckstand und beim oeffentlichen Repository.

Ein haengender Lauf faerbt nur, wenn er in den letzten 48 Stunden begonnen hat -
dann koennte er noch etwas bedeuten.

### Warum getrennt von db_monitor

Die Abfrage laeuft als zweite Anfrage an dieselbe Neon-Datenbank, nicht als
Anhaengsel an `db_monitor.report()`. Das tragbare Paket darf nichts von KC
wissen. Faellt die Sicherungsabfrage aus, betrifft das nur diese Kachel; die
Kapazitaets- und Sicherheitswerte der Spiegeldatenbank kommen trotzdem.

Im Alarmregelwerk haengt `backup` an `neon`: ist die Spiegeldatenbank nicht
erreichbar, ist auch der Zustand der Sicherung nicht lesbar - dann meldet die
Ursache und nicht beides.

## Lebenszeichen der Programme

Ausgangslage, nachgesehen statt vermutet: es gab **drei** Listen, die nicht
zusammenpassen.

| Liste | Umfang | IDs |
| --- | --- | --- |
| `kc_core_app_registry` (Datenbank) | 13 aktive Anwendungen | `KC_MARKTKASSE` |
| `kicc_program_heartbeats` (Datenbank) | 3 meldende Programme | `kc-dp2` |
| KICC-Produktkatalog (JavaScript) | 18 Eintraege | `kc-bilderkasse` |

Eine vierte anzulegen waere derselbe Fehler noch einmal. Deshalb hat die
vorhandene Registrierung drei Spalten bekommen: `heartbeat_program_id`,
`heartbeat_expected`, `heartbeat_max_age_minutes`.

### Was ein Lebenszeichen belegt - und was nicht

**Es belegt:** dieses Programm war zu diesem Zeitpunkt in Benutzung, in dieser
Version, mit diesen Kennzahlen.

**Es belegt nicht:** dass ein Dienst laeuft. Die Lebenszeichen kommen aus dem
Browser. Hat niemand die Anwendung offen, kommt nichts - nachts, am Wochenende,
in der Mittagspause. Das ist kein Ausfall.

Daraus folgt die wichtigste Regel dieser Kachel: **Schweigen ist kein Befund**,
solange nicht jemand ausdruecklich entschieden hat, dass sich ein Programm in
einem Zeitfenster melden MUSS. `heartbeat_expected` steht deshalb ab Werk auf
falsch. Waere es anders, stuenden zwoelf Anwendungen ohne Grund auf Rot.

Solange kein Programm scharfgestellt ist, meldet die Kachel **nicht
eingerichtet** und faellt aus der Abdeckung heraus - statt eine Zahl zu
beschoenigen, hinter der zwoelf ungeprueft Anwendungen stehen.

### Was sehr wohl zaehlt

Ein Programm, das **von sich aus Fehler meldet**, hat gesprochen. Das zaehlt
immer, auch ohne Scharfstellung. Die erste Fassung dieser Kachel hat genau das
verschluckt: sie gab bei "nichts scharfgestellt" sofort zurueck und uebersah
dabei, dass KC Dienstplan drei Fehler gemeldet hatte. Gefunden beim ersten Lauf
gegen die echten Daten.

Gewertet wird allein `errorCount`. **`DEGRADED` ist keine Stoerung** - die
Melder setzen es, sobald das Fenster in den Hintergrund geht. Als Befund
gewertet meldete jeder Tabwechsel einen.

Ein gemeldeter Fehler ist eine **Warnung, kein Ausfall**: der Zaehler ist selbst
gemeldet und heisst in jedem Programm etwas anderes.

### Ein Programm anbinden

Das Paket `share/heartbeat/` ist eine Datei und eine Zeile Einbau. Danach
erscheint das Programm als "angebunden". Ueberwacht wird es erst, wenn jemand
das ausdruecklich einträgt:

```sql
update public.kc_core_app_registry
   set heartbeat_program_id      = 'kc-bilderkasse',
       heartbeat_expected        = true,
       heartbeat_max_age_minutes = 60
 where app_id = 'KC_MARKTKASSE';
```

Nur `KC_DP` ist zugeordnet, weil `kc-dp2` sich nachweislich meldet. Alle
uebrigen Zuordnungen waeren geraten gewesen, und eine geratene Zuordnung
ueberwacht das falsche Programm.

### Was das nicht leistet

Das Lebenszeichen ist selbstgemeldet. Ein abgestuerztes Programm meldet nicht,
dass es abgestuerzt ist - es meldet gar nichts. Fuer einen echten
Verfuegbarkeitsnachweis braucht es eine Pruefung von aussen. Diese Kachel
beantwortet die kleinere, aber nuetzliche Frage: laeuft die Version, die ich
erwarte, und meldet sie Fehler?
