# Marktbetrieb – Router-/Internet-Telemetrie

Stand: 0.8.0-beta.12

Ziel ist eine belastbare, aber fehlalarmarme Anzeige des Markt-Netzes im KC System Check. Der Vertrag ist additiv; bestehende Heartbeats und Alarmregeln werden nicht verändert.

## Erkennung

Der Leitstand erkennt einen Router-/Netz-Heartbeat, wenn `program_id` einen der Begriffe `router`, `gateway`, `internet`, `network` oder `netz` enthält. Pro `instance_id`/`source_id` wird nur der jüngste Datensatz berücksichtigt.

## Pflichtfelder

- `program_id`
- `instance_id` oder `source_id`
- `status`
- `measured_at` oder `received_at`

## Optionale Messwerte

- `latency_ms`: gemessene Internet-/Gateway-Latenz in Millisekunden
- `signal_percent` oder `wifi_signal_percent`: WLAN-/Mobilfunksignal in Prozent
- `traffic_rx`, `traffic_tx`: vorhandene Verkehrsmetriken
- `error_count`: Fehlerzähler

## Bewertung

Ein vorhandener Heartbeat wird bis 90 Sekunden als aktuell bewertet. Zwischen 90 und 180 Sekunden wird `PRÜFEN` angezeigt. Ab mehr als 180 Sekunden wird `NICHT AKTIV` angezeigt.

Für einen frischen Heartbeat gelten zusätzlich:

- `ONLINE`, `OK`, `HEALTHY`, `CONNECTED` → `OK`
- `DEGRADED`, `WARNING`, `WARN` → `PRÜFEN`
- `ERROR`, `FAILED`, `CRITICAL`, `BAD`, `OFFLINE`, `DISCONNECTED` → `STÖRUNG`
- Latenz ab 1000 ms → `PRÜFEN`
- Latenz ab 3000 ms → `STÖRUNG`
- Signal unter 30 % → `PRÜFEN`
- Signal unter 15 % → `STÖRUNG`

Fehlt die Router-Telemetrie vollständig, bleibt die Anzeige neutral auf `TELEMETRIE VORBEREITET`. Das ist ausdrücklich kein Ausfall.

## Sicherheitsprinzip

Der System Check liest diese Werte nur. Er konfiguriert weder Router noch SIM, WLAN, Firewall, DNS oder Mobilfunkzugang. Eine spätere aktive Netzdiagnose muss separat freigegeben werden.
