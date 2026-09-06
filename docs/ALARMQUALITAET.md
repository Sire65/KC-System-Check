# Alarmqualitaet

Ein Alarm ist erst dann ein Alarm, wenn er **bestaetigt**, **nicht
abgeleitet** und **nicht stummgeschaltet** ist. Das Regelwerk liegt
zweimal identisch vor:

- `js/alarm-policy.js` fuer die App (reine Funktionen, 14 Unit-Tests)
- `public.kc_system_check_alarm_apply()` fuer die Serveralarmierung
  (10 SQL-Pruefungen gegen eine echte PostgreSQL-Instanz)

Die Regeln selbst stehen in `config/alarm-policy.json` - Konfiguration,
nicht Code.

## 1. Entprellung

| Zielzustand | noetige Messungen |
|-------------|-------------------|
| `critical`  | 2 |
| `warning`   | 2 |
| `unknown`   | 3 |
| `healthy`   | 3 |

Entwarnung braucht mehr Bestaetigung als Alarm: lieber einmal zu lange
rot als ein Flattern zwischen gruen und rot. Ein einzelner Messfehler -
etwa eine WLAN-Schwankung am Stand - erzeugt keinen Alarm mehr.

## 2. Abhaengigkeitsunterdrueckung

`dependencies` nennt je Signal seine Voraussetzungen. Ist eine davon
bestaetigt gestoert, ist das Signal ein Folgealarm und wird unterdrueckt.
Faellt KC Core aus, meldet der Leitstand die Ursache - nicht zusaetzlich
Spiegelung, Sicherheitsaudit und Kapazitaet. Die Unterdrueckung ist
sichtbar ("2 Folgealarme unterdrueckt"), nicht stillschweigend.

Seit v0.7.13 haengt die Spiegelung ausserdem an `neon`: ist die
Spiegeldatenbank nicht erreichbar, scheitern auch die Spiegellaeufe. Dann
soll eine Meldung kommen, nicht zwei.

**Bekannte Luecke, damit sie nicht unbemerkt bleibt:** dieses Regelwerk wirkt
zurzeit nur in der App. `kc-live-operations-watch` ruft
`kc_system_check_alarm_apply()` mit `p_policy:{}` auf - serverseitig gelten
also die eingebauten Vorgaben der Funktion, und `dependencies` ist dort leer.
Entprellung und Wiedervorlage stimmen zufaellig ueberein, weil die Vorgaben in
der Funktion dieselben Zahlen tragen; die Abhaengigkeiten aber nicht. Wer das
schliessen will, muss die Regeln an einen Ort legen, den beide Seiten lesen -
das ist offen und bewusst nicht nebenbei erledigt worden.

## 3. Wartungsfenster

`suppressed_until` je Signal schaltet befristet stumm. Ein abgelaufenes
Fenster schaltet nicht mehr stumm - es gibt keine dauerhafte
Stummschaltung aus Versehen.

## 4. Wiedervorlage und Eskalation

Ein bestehender Alarm wird nicht bei jeder Messung erneut verschickt,
sondern erst nach `renotifyAfterMinutes` (60). Ein `critical`, das
laenger als `escalateAfterMinutes` (15) offen ist, gilt als eskaliert.

## 5. Totmannschalter

`.github/workflows/watchdog.yml` laeuft alle sechs Stunden ausserhalb
des ueberwachten Systems und schlaegt fehl, wenn der juengste
protokollierte Pruflauf aelter als 25 Stunden ist. Serverseitig
beantwortet `public.kc_system_check_watchdog()` dieselbe Frage, damit
KICC sie ebenfalls stellen kann.

## Noch offen

`kc-system-check-alerts` liegt nicht in diesem Repository. Damit die
Serveralarmierung diese Regeln nutzt, muss sie ihre Signale durch
`kc_system_check_alarm_apply()` schicken und nur noch das versenden, was
in `notify` zurueckkommt. Solange das nicht geschehen ist, gilt die
Alarmqualitaet nur in der App.
