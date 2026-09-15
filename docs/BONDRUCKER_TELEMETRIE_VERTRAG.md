# KC System Check – Bondrucker-Telemetrievertrag

Ziel: Bondrucker im Marktbetrieb nur dann bewerten, wenn echte Telemetrie vorliegt. Fehlende Telemetrie ist kein Ausfall.

## Erkennung

Ein Heartbeat wird als Bondrucker erkannt, wenn `program_id` z. B. `printer`, `bondruck`, `receipt` oder `tm-t88` enthält.

## Pflichtfelder

- `program_id`
- `instance_id` oder `source_id`
- `status`
- `measured_at` oder `received_at`

## Optionale Felder

- `connection_type`, alternativ `transport` oder `interface` – z. B. `BLUETOOTH`, `WLAN`, `LAN`
- `paper_status`, alternativ `paper` – z. B. `OK`, `LOW`, `EMPTY`
- `print_error_count`, alternativ `printer_error_count` oder `error_count`

## Bewertung

- kein Heartbeat: `TELEMETRIE VORBEREITET`
- bis 90 Sekunden alt: aktuell
- 90–180 Sekunden alt: `PRÜFEN`
- älter als 180 Sekunden: `NICHT AKTIV`
- Status `ERROR`, `FAILED`, `CRITICAL`, `BAD`, `OFFLINE` oder `DISCONNECTED`: `STÖRUNG`
- Papier `EMPTY`, `OUT`, `NO_PAPER` oder `PAPER_OUT`: `STÖRUNG`
- Papier `LOW`, `NEAR_END` oder `PAPER_LOW`: `PRÜFEN`
- gemeldete Druckfehler > 0: `PRÜFEN`

Die Schnittstelle ist additiv. Nicht vorhandene optionale Felder erzeugen keinen Alarm.