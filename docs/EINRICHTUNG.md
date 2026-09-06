# Einrichtung in einer eigenen Umgebung

Diese Anleitung richtet sich an jemanden, der den KC System Check für **seine
eigene** Supabase-Umgebung einsetzen will. Sie ist bewusst so geschrieben, dass
sie ohne Rückfragen durchläuft.

Wenn du nur die SQL-Überwachung willst und nicht das ganze Programm: nimm
[`share/db-monitor/`](../share/db-monitor/). Eine Datei, zwei Zeilen, fertig.

## Was du brauchst

- ein Supabase-Projekt (der kostenlose Tarif genügt)
- einen Ort, an dem die PWA liegt (GitHub Pages genügt)
- 20 Minuten

Nicht nötig: Neon, ein zweites Supabase-Projekt, eine Sicherung, ein
Spiegelbetrieb. Alles davon ist optional — was fehlt, meldet die zugehörige
Kachel als **„nicht eingerichtet"** und wird aus der Abdeckung herausgerechnet.
Nichts steht deswegen rot.

## 1. Migrationen einspielen

Im SQL Editor deines Projekts, in dieser Reihenfolge:

```
202609010510_kc_system_check_history_v1.sql
202609010516_kc_system_check_history_explicit_deny.sql
202609060001_kc_system_check_operators.sql
202609060002_kc_system_check_audit.sql
202609060003_kc_alarm_quality.sql
202609060011_db_monitor_paket.sql
202609060012_kc_externe_zugaenge.sql
202609060013_db_monitor_paket_v2.sql
202609060014_kc_alarmregelwerk_gemeinsam.sql
202609060015_kc_erste_messung_meldet_nicht.sql
202609060016_kc_alarmregelwerk_sicherung.sql
202609060019_kc_portabilitaet_zugaenge.sql
```

Genau diese Reihenfolge wird bei jedem Testlauf gegen eine **leere** Datenbank
geprüft (`tests/sql/fremde-umgebung.test.sql`). Läuft sie dort durch, läuft sie
auch bei dir.

Die übrigen Migrationen (`…0004` bis `…0010`, `…0017`, `…0018`) setzen
KC-eigene Tabellen voraus — Spiegelung, Sicherung, Anwendungsregistrierung.
Spiel sie nur ein, wenn du diese Tabellen hast.

**Danach unbedingt:** die beiden Zugänge aus `…0019` gehören *dir*, nicht uns.
Ändere sie:

```sql
delete from public.kc_external_credentials where name in ('github_repo','future_academy');

insert into public.kc_external_credentials (name, kind, endpoint, secret, label) values
  ('github_repo', 'github_api', 'https://api.github.com/repos/DEIN-KONTO/DEIN-REPO', '', 'Mein Repository');
```

Lässt du das weg, prüft dein System Check ein fremdes Repository. Die
Einrichtung ist erst damit fertig.

## 2. Edge Function einspielen

`supabase/functions/kc-system-check/index.ts` mit `verify_jwt: true`
veröffentlichen. Sie braucht keine eigenen Umgebungsvariablen — `SUPABASE_URL`,
`SUPABASE_ANON_KEY` und `SUPABASE_SERVICE_ROLE_KEY` setzt Supabase selbst.

## 3. Sich selbst freischalten

Ohne Freischaltung ist der Leitstand gesperrt, und das ist Absicht:

```sql
insert into public.kc_system_check_operators (user_id, role, active)
values ('<deine auth.users-ID>', 'superadmin', true);
```

## 4. Die App verbinden

`config/runtime.public.json`:

```json
{
  "apiBaseUrl": "https://<dein-projekt>.supabase.co/functions/v1/kc-system-check",
  "apiToken": "<dein öffentlicher Schlüssel>",
  "apiStyle": "supabase-edge",
  "mode": "live"
}
```

Der Schlüssel hier ist der **öffentliche**. Er ist Türöffner, keine
Berechtigung — wer damit den Leitstand aufruft, bekommt 403. Ein
Dienstschlüssel gehört nicht in diese Datei; die GitHub-Kachel meldet ihn als
Fund, wenn er doch dort landet.

## 5. Automatik (optional)

```sql
select cron.schedule('system-check-15m', '*/15 * * * *',
  $$select net.http_get(url := 'https://<dein-projekt>.supabase.co/functions/v1/kc-system-check-alerts?run=1',
    headers := '{"x-kc-automation":"<dein Automatikgeheimnis>"}'::jsonb)$$);
```

Das Geheimnis wird vorher in `kc_automation_credentials` hinterlegt — nur sein
SHA-256-Abdruck, nie der Wert selbst.

## Optionale Kacheln scharfstellen

| Kachel | Eintrag | Ohne den Eintrag |
| --- | --- | --- |
| Zweites Supabase-Projekt | `future_academy` in `kc_external_credentials` | nicht eingerichtet |
| Neon-Spiegeldatenbank | `neon_mirror`, dazu `db_monitor` in der Neon-Datenbank | die vorbereitete Kachel bleibt stehen |
| Sicherung | derselbe `neon_mirror`-Zugang, plus die Sicherungstabellen | nicht eingerichtet |
| Programme · Lebenszeichen | Migration `…0017` und `share/heartbeat/` in den Programmen | nicht eingerichtet |

## Was du nicht bekommst

Ehrlich vorweg, damit du es nicht erst im Betrieb merkst:

- **Die Kachelliste steht noch im Quelltext.** Sie ist nicht konfigurierbar.
  Wer eine eigene Prüfung ergänzen will, ändert die Edge Function. Die
  Endpunkte sind Konfiguration, die Liste der Prüfungen ist es nicht.
- **Die Texte sind deutsch**, fest verdrahtet. Keine Sprachumschaltung.
- **Der Leitstand** (Live-Betrieb, Kassen-Telemetrie) setzt KC-eigene Tabellen
  voraus und läuft in einer fremden Umgebung nicht. Der System Check selbst
  schon.
- **Lebenszeichen sind selbstgemeldet.** Ein abgestürztes Programm meldet
  nicht, dass es abgestürzt ist — es meldet gar nichts.

## Wenn etwas nicht läuft

Die Prüfung antwortet auch dann, wenn Teile fehlen. Eine Kachel auf **grau**
heißt „nicht eingerichtet", nicht „kaputt". Eine Kachel auf **grau mit dem Wort
*unbekannt*** heißt: konnte nicht geprüft werden — und das gilt ausdrücklich
nicht als in Ordnung.

Bleibt die ganze Antwort aus, ist meist die Freischaltung aus Schritt 3
vergessen worden: ohne sie liefert `?leitstand=1` ein 403, die normale Prüfung
aber trotzdem ein Ergebnis.
