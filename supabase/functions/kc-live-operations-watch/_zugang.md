Diese Funktion lag bisher in keinem Repository. Aufgenommen am 2026-09-06,
Stand: die deployte Version 3, ergaenzt um zwei Dinge:

1. Zugangspruefung. Vorher konnte jeder mit dem oeffentlichen Schluessel den
   kompletten Betriebszustand abrufen und mit ?run=1 die Alarmierung ausloesen.
   Jetzt: entweder ein freigeschaltetes Konto (kc_system_check_operator_role)
   oder die Automatik-Kennung (kc_automation_verify), die ausschliesslich in
   der Datenbank liegt. Der oeffentliche Schluessel bleibt Gateway-Schluessel,
   ist aber keine Berechtigung mehr.

2. Entprellung. Vorher loeste jeder Zustandswechsel sofort einen Alarm aus -
   eine einzelne verpasste Heartbeat-Meldung genuegte. Jetzt entscheidet
   kc_system_check_alarm_apply(), also dasselbe Regelwerk wie in der App.
   Faellt der Aufruf aus, greift die alte Sofortlogik als Rueckfall: lieber
   ein Alarm zu viel als eine verschluckte Stoerung.
