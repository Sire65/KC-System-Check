# Money-Butler-Telemetrievertrag

Ziel: Der KC System Check bewertet den Money Butler im Marktbetrieb nur anhand tatsächlich gelieferter Telemetrie. Fehlende Telemetrie bleibt neutral.

## Erkennung
Ein Heartbeat gilt als Money Butler, wenn `program_id` auf `money-butler`, `money_butler`, `cash-butler` oder `cash_butler` passt.

## Zeitbewertung
- bis 90 Sekunden: aktuell
- über 90 bis 180 Sekunden: PRÜFEN
- über 180 Sekunden: NICHT AKTIV

## Unterstützte optionale Felder
- `status`
- `measured_at` oder `received_at`
- `transfer_status`, `handover_status` oder `cash_transfer_status`
- `fill_status`, `load_status` oder `stock_status`
- `fill_percent`, `load_percent` oder `stock_percent`
- `transfer_error_count`, `cash_error_count` oder `error_count`

## Bewertung
STÖRUNG bei echten Fehlerzuständen wie `FAILED`, `ERROR`, `BLOCKED` oder `JAMMED` in der Geldübergabe bzw. `FAILED`, `ERROR`, `EMPTY` oder `BLOCKED` beim Füllstatus.

PRÜFEN bei gemeldeten Fehlern, wartender/ausstehender Übergabe (`PENDING`, `WAITING`, `DEGRADED`) oder einem gemeldeten Füllstand unter 20 Prozent.

Fehlen einzelne optionale Werte, wird daraus kein Alarm erzeugt. Ohne passenden Heartbeat zeigt der Leitstand `TELEMETRIE VORBEREITET`.