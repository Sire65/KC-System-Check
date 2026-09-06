# Leitstand-Zugang und Rollen

Ab Version 0.7.0 ist der LIVE-Leitstand nicht mehr oeffentlich. Der
oeffentliche anon-Schluessel gilt nur noch als Gateway-Schluessel fuer
Supabase, nicht als Berechtigung.

## Rollen

| Rolle        | Sieht                                                       |
|--------------|-------------------------------------------------------------|
| `superadmin` | alles, einschliesslich Kassenereignisse (Betrag, Zahlungsart) |
| `technik`    | alle technischen Zustaende, **keine** Kassenereignisse        |
| kein Eintrag | keinen LIVE-Leitstand (HTTP 403)                              |

Die technische Pruefung (ONE TOUCH, Verlauf, Kapazitaet) bleibt ohne
Anmeldung nutzbar - sie enthaelt keine Betriebs- oder Kassendaten.

## Einmalige Freischaltung

1. Migration `202609060001_kc_system_check_operators.sql` einspielen.
2. Edge Function `kc-system-check` neu deployen.
3. Im SQL-Editor das eigene Konto freischalten:

```sql
insert into public.kc_system_check_operators (user_id, role, note)
select id, 'superadmin', 'Erstfreischaltung'
from auth.users
where email = 'BITTE-EIGENE-ADRESSE@example.com'
on conflict (user_id) do update set role = excluded.role, active = true;
```

Weitere Personen bekommen in der Regel `technik`. Zugang entziehen:
`update public.kc_system_check_operators set active = false where user_id = '...';`

## Verlauf schreiben

Angemeldete Betreiber schreiben bei jedem Lauf einen Verlaufseintrag.
Nicht angemeldete Aufrufe (auch der taegliche GitHub-Action-Lauf) werden
hoechstens alle 10 Minuten protokolliert. Damit kann ein oeffentlich
bekannter Schluessel die Verlaufstabelle nicht mehr fluten. Das Feld
`recorded` in der Antwort sagt, ob der Lauf gespeichert wurde.

## Was diese Aenderung nicht loest

`kc-live-operations-watch` (Fernschutz) und `kc-system-check-alerts`
liegen nicht in diesem Repository. Die App sendet dorthin jetzt die
Nutzeranmeldung statt des anon-Schluessels; die serverseitige Pruefung
dieser Anmeldung muss in diesen Funktionen noch nachgezogen werden.
