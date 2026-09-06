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

Seit v0.7.14 gilt das auch serverseitig. Vorher war `dependencies` dort leer,
weil die Aufrufer `p_policy:{}` uebergeben: das Regelwerk liegt jetzt in
`kc_system_check_alarm_policy` und wird benutzt, wenn der Aufrufer keins
mitgibt. Inhaltsgleich mit `config/alarm-policy.json`; ein Test vergleicht
beide.

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

## 6. Was die Alarmierung wirklich benutzt

Der wichtigste Befund dieser Runde, und der unangenehmste: **die Alarmierung,
die als Push und E-Mail ankommt, hat dieses Regelwerk nie aufgerufen.**
`kc-system-check-alerts` entschied allein aus dem Sprung des Gesamtzustands -
gruen nach gelb, gelb nach rot. Kein Entprellen, keine Abhaengigkeiten, kein
Wartungsfenster. Ein einzelner Aussetzer genuegte fuer eine Meldung. Der Kopf
von Migration 202609060003 behauptete bereits seit dem ersten Tag das
Gegenteil.

Seit v0.7.14 baut die Alarmierung aus den Kachelergebnissen Signale - mit
demselben Sieb wie die App, `not_configured` und `disabled` fliegen raus - und
laesst `kc_system_check_alarm_apply()` entscheiden. Verschickt wird nur, was in
`notify` zurueckkommt. Wieviele Folgealarme unterdrueckt wurden, steht in der
Nachricht, damit die Unterdrueckung sichtbar bleibt.

Zwei Regeln sind dabei neu:

**`renotifyStatuses`** - nur diese Zustaende werden nach
`renotifyAfterMinutes` erneut gemeldet, voreingestellt allein `critical`. Eine
offene Warnung ist eine Aufgabe, kein Vorfall; stuendlich wiederholt liest sie
niemand mehr. Ohne diese Regel haette die bewusst offene GitHub-Warnung ab
sofort jede Stunde gemeldet.

**`recovered`** - die Entwarnung gehoert in dieselbe Auswertung wie der Alarm
und nicht in den Aufrufer. Gemeldet wird sie nur fuer Signale, fuer die vorher
auch wirklich alarmiert wurde, und erst wenn nichts mehr offen ist. Sonst
entwarnt das System vor etwas, wovon niemand erfahren hat, oder waehrend eine
zweite Stoerung weiterlaeuft.

### Beim Umstellen zu erwarten

Der erste Lauf legt fuer jedes Signal einen Zustand an. Was dabei nicht gruen
ist, meldet einmal - vorher durchgerechnet und wieder zurueckgerollt: genau ein
Signal, die bewusste GitHub-Warnung. Danach ist Ruhe, weil Warnungen nicht
wiedervorgelegt werden. Der Alternativweg waere gewesen, den Zustand still
vorzubelegen; dann haette das System beim Start alles Kaputte als bekannt
abgehakt. Eine ehrliche Meldung ist besser.

## 7. Der erste Blick zaehlt noch nicht

Am 2026-09-06 um 10:00 lief die neue Alarmierung zum ersten Mal scharf. Sie
meldete zwei Signale: die bewusst offene GitHub-Warnung - vorhergesagt - und
die Neon-Kachel mit "1 Tabelle mit echtem Vacuum-Rueckstand". Beim naechsten
Lauf fuenfzehn Minuten spaeter war Neon wieder gruen. Die Spiegeldatenbank wird
staendig beschrieben; dass eine Tabelle fuer einen Moment ueber die
Ausloeseschwelle rutscht, ist Normalbetrieb.

Genau davor soll die Entprellung schuetzen - sie griff hier nicht. Grund: beim
allerersten Sehen eines Signals gab es keine Vorgeschichte, der gemessene
Zustand galt sofort als bestaetigt, und "bestaetigt" meldet. Fuer ein neues
Signal genuegte damit **eine einzige Messung** - das Gegenteil dessen, was
`confirmAfter` zusichert.

Seit v0.7.16 gilt: der erste gemessene Zustand wird uebernommen, aber nicht
gemeldet. Gemeldet wird er, sobald er so oft bestaetigt ist, wie ein Wechsel es
brauchen wuerde. Ein System, das von Anfang an gestoert ist, meldet damit
weiterhin - nur eine Messung spaeter. Dauerhaft stumm bleibt nichts.

Gezaehlt wird das in einer eigenen Spalte `confirmed_seen`. Der erste Versuch
benutzte dafuer `streak`, das im Wechselfall aber die Messungen des
**Kandidaten** zaehlt: ein Signal auf dem Weg von gelb nach gruen meldete
dadurch unterwegs noch einmal seine alte Warnung nach. Aufgefallen ist das dem
SQL-Test, nicht dem Betrieb - beide Seiten haben jetzt einen Test dafuer.
