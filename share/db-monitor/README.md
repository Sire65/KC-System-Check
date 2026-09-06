# db_monitor — tragbare SQL-Überwachung für PostgreSQL

Eine einzelne SQL-Datei. Sie legt drei Funktionen an, die aus den Katalog- und
Statistiktabellen von PostgreSQL ablesen, wie es der Datenbank geht:
Sicherheitslage und Kapazität. **Nutzdaten werden nie gelesen**, nur Metadaten.

Herkunft: entstanden im KC System Check. Dort läuft dieselbe Datei — die
KC-Prüfungen rufen diese Funktionen auf, statt die Logik ein zweites Mal zu
führen.

## Wofür das gut ist

Die üblichen Fehler in einer Datenbank sieht man nicht, wenn man sie nicht
sucht. Diese hier findet sie:

| Befund | Warum das wichtig ist |
| --- | --- |
| Tabelle ohne Row Level Security | Auf Supabase reicht der öffentliche Schlüssel, um sie über die REST-API auszulesen. |
| View mit Eigentümerrechten | Eine gewöhnliche View läuft mit den Rechten ihres Eigentümers und hebelt damit RLS der darunterliegenden Tabelle aus. Dasselbe gilt für materialisierte Views — die können gar kein RLS. |
| Policy mit `using (true)` | „alle dürfen lesen“. Kann gewollt sein, gehört aber angesehen. |
| Ungedecktes Recht | Eine Client-Rolle hat ein Recht auf etwas, das nichts schützt. Das ist der eine Befund, der wirklich ein offenes Loch ist. |
| `security definer` ohne festes `search_path` | Bekannter Angriffsweg: wer das `search_path` setzen kann, entscheidet, welche Funktion die Definer-Funktion aufruft. |
| Sequenz über 70 % ausgeschöpft | Läuft sie über, schlägt jedes Einfügen fehl. Kommt ohne Vorwarnung. |
| Echter Vacuum-Rückstand | Autovacuum kommt nicht mehr hinterher, die Tabelle wächst ins Leere. |
| Leerraum im Heap | Belegter Platz, der keine Daten trägt — auf einem Kontingent teuer. |
| Kaum genutzter Index | Speicher, der sich ohne Datenverlust und ohne Sperre zurückholen lässt. |

## Einspielen

```bash
psql "$DATABASE_URL" -f install.sql
```

Läuft ab PostgreSQL 13. Keine Erweiterung nötig, kein Schreibzugriff auf
Nutzdaten, kein Superuser erforderlich — es genügt eine Rolle, die im geprüften
Schema lesen darf. Die Datei ist wiederholbar: erneutes Einspielen ersetzt die
Funktionen und ändert sonst nichts.

### Supabase

Im SQL Editor den Inhalt von `install.sql` einfügen und ausführen. Die Datei
erkennt die Rollen `anon`, `authenticated` und `service_role` selbst und vergibt
die Aufrufrechte nur an `service_role`. Danach ist der Bericht aus einer Edge
Function heraus mit dem Service-Schlüssel abrufbar:

```sql
select db_monitor.report();
```

### Neon

```bash
psql "postgresql://…neon.tech/neondb?sslmode=require" -f install.sql
```

Auf Neon gibt es die Supabase-Rollen normalerweise nicht. Die Datei merkt das
und überspringt die entsprechenden Rechte — sie läuft trotzdem durch. Der
Bericht meldet dann keine RLS-Befunde als kritisch, sondern schreibt in die
Hinweise: *„… aber keine der geprüften Client-Rollen existiert — kein Zugriff
aus dem Netz möglich“*. Das ist Absicht: ohne eine Rolle, die aus dem Netz
erreichbar ist, ist RLS keine Pflicht, und eine Ampel, die immer rot steht,
liest nach zwei Wochen niemand mehr.

Wer auf Neon die Data API benutzt, gibt die dortigen Rollen einfach mit:

```sql
select db_monitor.report('public', array['authenticated','anonymous']);
```

## Aufrufen

```sql
-- Gesamtbild, lesbar formatiert
select jsonb_pretty(db_monitor.report());

-- nur die Sicherheitslage, anderes Schema, eigene Client-Rollen
select db_monitor.security_audit('app', array['web_user']);

-- nur die Kapazität
select db_monitor.capacity();
```

`report()` liefert:

```json
{
  "status": "healthy | warning | critical",
  "critical": ["…"],
  "warnings": ["…"],
  "notes": ["…"],
  "connection_percent": 6.0,
  "security": { … },
  "capacity": { … }
}
```

## Wie der Zustand zustande kommt

Die Einteilung ist der eigentliche Kern und bewusst zurückhaltend:

- **critical** — eine Client-Rolle erreicht Daten, die nichts schützt; eine
  Sequenz ist über 70 % ausgeschöpft; über 90 % der Verbindungen sind belegt.
- **warning** — Policy mit uneingeschränktem Zugriff, `security definer` ohne
  `search_path`, echter Vacuum-Rückstand, über 50 % Leerraum in einer großen
  Tabelle, über 70 % der Verbindungen belegt.
- **notes** — Sparmöglichkeiten. Färben die Ampel **nicht**.

Zwei Entscheidungen dahinter, beide aus dem Betrieb gelernt:

**Ein Recht ist nur dann ein Befund, wenn es nichts deckt.** Supabase vergibt
Tabellenrechte an `anon` und `authenticated` standardmäßig; gedeckt werden sie
durch RLS. Wer jedes dieser Rechte meldet, bekommt dreistellige Zahlen und eine
Prüfung, die dauerhaft rot steht und deshalb nichts mehr wert ist.

**Rückstand heißt: mehr als das Doppelte der Auslöseschwelle.** Autovacuum
greift bei `autovacuum_vacuum_threshold + scale_factor × lebende Zeilen`. Eine
feste Zahl toter Zeilen als Grenze meldet den Normalbetrieb jeder größeren
Tabelle.

## Regelmäßig laufen lassen

Mit `pg_cron` (auf Supabase vorhanden, auf Neon nicht):

```sql
create table if not exists db_monitor_log (
  id bigserial primary key,
  checked_at timestamptz not null default now(),
  report jsonb not null
);

select cron.schedule('db-monitor', '0 * * * *',
  $$insert into db_monitor_log (report) select db_monitor.report()$$);
```

Ohne `pg_cron` genügt ein Cronjob:

```bash
psql "$DATABASE_URL" -Atc "select db_monitor.report() ->> 'status'"
```

## Grenzen — was das hier nicht tut

- Es misst nur, was im Katalog steht. Ob eine Policy fachlich das Richtige
  erlaubt, kann es nicht wissen — nur, dass sie uneingeschränkt ist.
- Der Leerraum ist geschätzt (`pg_stats`), nicht gemessen. Für eine genaue Zahl
  gibt es `pgstattuple`; die Schätzung genügt, um zu entscheiden, ob sich ein
  Blick lohnt.
- Verbindungen zählt es über `pg_stat_activity`. Hinter einem Pooler
  (Supabase Pooler, PgBouncer) ist das die Zahl der Datenbankverbindungen, nicht
  die der Anwendungsverbindungen.
- Es schreibt nichts und räumt nichts auf. Was zu tun ist, entscheidet ein
  Mensch.

## Lizenz

Gleiche Lizenz wie das umgebende Projekt. Weitergabe ausdrücklich erwünscht.
