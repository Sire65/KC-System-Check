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

Die Neon-Seite wird vom KC System Check bisher nur auf Erreichbarkeit geprueft.
Die Funktionen liegen jetzt dort bereit; damit die Kachel sie auch liest, braucht
die Edge Function einen Neon-Zugang. Das ist noch offen und bewusst nicht mit
erledigt worden.
