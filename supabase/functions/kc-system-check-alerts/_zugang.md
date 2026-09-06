Diese Funktion lag bisher in keinem Repository. Aufgenommen am 2026-09-06,
Stand: die deployte Version 8, ergaenzt um die Zugangspruefung.

Vorher: GET ohne jede Pruefung. Jeder mit dem oeffentlichen Schluessel konnte
die Alarmeinstellungen samt Provider-Zustand und letztem Zustellversuch lesen
und mit ?run=1 einen Pruflauf samt Alarmierung ausloesen.

Jetzt: lesen darf ein freigeschaltetes Konto, ausloesen (?run=1) nur die
Automatik-Kennung. POST bleibt unveraendert bei isAdmin() ueber
kc_core_user_links - dieselbe Rollenliste, auf die auch
kc_system_check_operator_role() aufsetzt.
