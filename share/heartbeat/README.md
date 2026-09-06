# KC-Lebenszeichen

Eine Datei, eine Zeile Einbau. Danach taucht das Programm im KC System Check
auf — mit Version, Zeitpunkt und, wenn gewünscht, eigenen Kennzahlen.

## Einbau

`kc-heartbeat.js` neben die eigenen Skripte legen und einmal aufrufen:

```html
<script type="module">
  import { startHeartbeat } from './kc-heartbeat.js';
  startHeartbeat({
    programId: 'kc-bilderkasse',
    name:      'KC Bilderkasse',
    version:   '1.4.2',
    endpoint:  'https://<projekt>.supabase.co/functions/v1/kicc-program-heartbeat',
    token:     '<öffentlicher Schlüssel>'
  });
</script>
```

Das war alles. Der erste Ruf geht nach fünf Sekunden raus, danach jede Minute
und zusätzlich, sobald das Fenster wieder in den Vordergrund kommt.

**Der Schlüssel ist der öffentliche Gateway-Schlüssel** — derselbe, der ohnehin
im Browser liegt. Er erlaubt nichts außer dem Melden. Ein Dienstschlüssel
gehört hier nicht hinein und wäre ein echter Fund.

## Eigene Kennzahlen

Optional. `errorCount` größer null färbt die Kachel im System Check — melde
hier also nur, was wirklich eine Störung ist, keine harmlosen Meldungen:

```js
startHeartbeat({
  …,
  metrics: () => ({
    errorCount: offeneFehler.length,      // echte Störungen
    queueDepth: warteschlange.length      // unverarbeitete Vorgänge
  })
});
```

Wirft die eigene Funktion, wird das Lebenszeichen trotzdem gesendet. Eine
kaputte Kennzahl darf nie dazu führen, dass ein Programm stumm wird.

Der Status wird automatisch gesetzt: `ONLINE` im Vordergrund, `DEGRADED`, sobald
das Fenster in den Hintergrund geht. **`DEGRADED` ist keine Störung** — es heißt
nur „gerade nicht im Blick". Der System Check wertet allein `errorCount`; würde
er `DEGRADED` als Befund lesen, meldete jeder Tabwechsel einen.

## Was ein Lebenszeichen bedeutet — und was nicht

**Es belegt:** dieses Programm war zu diesem Zeitpunkt in Benutzung, in dieser
Version, mit diesen Kennzahlen.

**Es belegt nicht:** dass ein Dienst läuft. Das Lebenszeichen kommt aus dem
Browser. Hat niemand die Anwendung offen, kommt nichts — nachts, am Wochenende,
in der Mittagspause. Das ist kein Ausfall.

Der KC System Check behandelt das entsprechend: ein ausbleibendes Lebenszeichen
ist **kein Befund**, solange die Anwendung nicht ausdrücklich scharfgestellt
wurde. Scharfstellen heißt: jemand entscheidet, dass sich dieses Programm in
einem bestimmten Zeitfenster melden *muss*, und trägt das ein:

```sql
update public.kc_core_app_registry
   set heartbeat_program_id    = 'kc-bilderkasse',
       heartbeat_expected      = true,
       heartbeat_max_age_minutes = 60
 where app_id = 'KC_MARKTKASSE';
```

Vorher steht die Anwendung im System Check als „angebunden, aber nicht
überwacht". Das ist ehrlicher als eine Ampel, die jede Nacht rot wird, weil
niemand an der Kasse steht.

## Sinnvolle Zeitfenster

| Anwendung | Fenster | Begründung |
| --- | --- | --- |
| Kasse während der Öffnungszeiten | 60 min | offen, solange verkauft wird |
| Verwaltungsoberfläche | — | nicht scharfstellen, wird sporadisch benutzt |
| Anzeige/TV, die dauerhaft läuft | 15 min | soll wirklich immer laufen |
| Dienst ohne Oberfläche | — | braucht einen serverseitigen Melder, nicht diesen |

Für einen Dienst ohne Browser ist dieses Paket das falsche Werkzeug. Es setzt
`window`, `localStorage` und `fetch` voraus.

## Was noch fehlt

Das Lebenszeichen ist selbstgemeldet (`trust: SELF_REPORTED`). Ein Programm,
das abgestürzt ist, meldet nicht, dass es abgestürzt ist — es meldet gar
nichts. Für einen echten Verfügbarkeitsnachweis braucht es eine Prüfung von
außen. Das Lebenszeichen beantwortet die kleinere, aber nützliche Frage: läuft
die Version, die ich erwarte, und macht sie Fehler?
