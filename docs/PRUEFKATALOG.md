# Pruefkatalog

Jede Pruefung liefert denselben Datensatz: `id`, `name`, `kind`, `status`,
`health`, `latency`, `usage`, `capacityLabel`, `detail`, `metrics`.
`status` ist `healthy`, `warning`, `critical`, `unknown` oder
`not_configured`. **Nur `healthy`, `warning` und `critical` zaehlen in
Gesamtwert und Pruefabdeckung** - alles andere bleibt ausdruecklich
unbewertet und wird nie als gesund dargestellt.

## Bestehend

| id | prueft | Schwelle |
|----|--------|----------|
| `kc_core` | Erreichbarkeit und Antwortzeit KC Core, Datenbankgroesse | > 3000 ms gelb, nicht erreichbar rot |
| `future_academy` | Erreichbarkeit Future Academy, Datenbankgroesse | > 3000 ms gelb |
| `mirror` | Spiegelung Supabase → Neon | Abweichung rot, Lauf > 180 min gelb, kein Lauf unbekannt |
| `neon`, `b2`, `r2`, `oci` | Read-only-Status bzw. Backup-Telemetrie | ohne Zugang `not_configured` |
| `github` | Repository erreichbar, Sichtbarkeit | oeffentlich oder archiviert gelb |

## Neu in 0.7.1

| id | prueft | Schwelle |
|----|--------|----------|
| `db_security` | Tabellen ohne RLS, Policies mit `using(true)`, direkte Rechte fuer `anon`/`authenticated` | Tabelle ohne RLS oder offene Policy rot, direkte Rechte gelb |
| `db_capacity` | Verbindungen gegen `max_connections`, groesste Tabellen, Sequenzausschoepfung, Vacuum-Rueckstand | ≥ 90 % Verbindungen oder Sequenz > 70 % rot, ≥ 70 % Verbindungen oder Vacuum-Rueckstand gelb |
| `endpoint_exposure` | Antwortet die Prüf-API oder der Leitstand ohne Anmeldung? | alles ausser 401/403 rot |
| `key_lifetime` | Restlaufzeit und Gesamtlaufzeit des oeffentlichen Schluessels | < 30 Tage rot, < 90 Tage oder > 5 Jahre Laufzeit gelb |

Alle vier lesen ausschliesslich Metadaten - keine Nutzdaten, keine
Schreibzugriffe, keine kostenpflichtigen Aufrufe. `db_security` und
`db_capacity` melden `not_configured`, solange die Migration nicht
eingespielt ist; sie faerben den Gesamtstatus dann nicht ein.

## Noch offen aus der Bestandsaufnahme

Schema-Drift zwischen Supabase und Neon, inhaltliche Pruefsummen statt
Zeilenzahlen, Restore-Drill, Zertifikatslaufzeiten, Auth-Anomalien,
synthetische Fachtransaktionen, Geraete- und Standorttelemetrie
(Akku, Netzqualitaet, Drucker, lokaler Speicher), ehrliche
Invocation-Zaehlung ueber alle Funktionen.
