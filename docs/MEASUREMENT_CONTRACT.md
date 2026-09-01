# Messvertrag v1

Jeder Live-Adapter liefert explizite Zustände und nur tatsächlich gemessene Werte.

Zulässige Statuswerte: `healthy`, `warning`, `critical`, `unknown`, `not_configured`, `disabled`.

Regeln:
- Fehlende Messung ist niemals `0 ms`.
- Spiegelung meldet Abweichungen, letzten erfolgreichen Lauf und Alter des Ergebnisses; Latenz nur wenn tatsächlich gemessen.
- Kapazität nur aus realen Providerdaten. Fehlende Werte werden als nicht verfügbar gezeigt.
- Der Gesamtstatus übernimmt mindestens die höchste aktive Warnstufe; ein kritischer Einzelbefund darf nicht durch Mittelwertbildung grün werden.
- Ressourcenverbrauch wird, soweit messbar, als Requests und Bytes protokolliert; Schätzwerte werden als Schätzung gekennzeichnet.
- Automatische Standardprüfung maximal einmal täglich; Tiefenprüfung nur manuell oder nach Warnung.
