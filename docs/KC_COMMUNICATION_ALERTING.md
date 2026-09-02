# KC System Check – KC Communication Alarmierung

Stand: v0.6.2

## Architektur

Die Alarmierung erfolgt serverseitig aus der Supabase Edge Function `kc-system-check`. Die öffentliche PWA enthält keinen Kommunikationsschlüssel und keinen Geräte-Token.

Der System Check ruft bei einem relevanten Zustandswechsel den zentralen `kc-communication-router` auf. Empfänger, Provider, Fallback, 0-Euro-Regel und Zustellprotokoll bleiben ausschließlich in KC Communication.

## Regeln

- `healthy -> warning`: `system_warning`, bevorzugt Push, E-Mail als Fallback.
- `healthy/warning -> critical`: `system_error`, Push und E-Mail.
- `warning/critical -> healthy`: `system_recovered`, Push.
- Gleichbleibende Zustände erzeugen keine neue Meldung.
- Einzel-/Auswahlläufe (`trigger=selected`) erzeugen keine Alarmierung.
- Alarmierung erfolgt nur bei 100 % Prüfabdeckung des jeweiligen Voll-Laufs.
- Zusätzlich besitzt KC Communication eine 6-Stunden-Deduplizierung als zweite Schutzschicht.

## Empfänger

Eigene Gruppe `system_check_admins`. Sie wurde initial aus dem bestehenden technischen Administrator-Empfängerbestand übernommen. Änderungen an Empfängern werden künftig zentral in KC Communication vorgenommen.

## Sicherheit

- Keine Service-Role-, Resend-, VAPID- oder sonstigen Provider-Schlüssel im Browser.
- Der interne Router-Aufruf erfolgt serverseitig mit der vorhandenen Supabase-Service-Berechtigung.
- Die PWA zeigt nur Statusdaten und löst die zentrale Zustellung nicht direkt aus.

## Fehler der Prüfengine

Wenn die serverseitige Prüffunktion selbst mit einem Fehler abbricht, wird ein dedupliziertes `system_error` an KC Communication übergeben, sofern der Communication-Router erreichbar ist.
