-- Push-Kalibrierung 2026-09-10
--
-- Ziel:
--   * GELB bleibt sofort im Leitstand sichtbar, erzeugt aber erst nach drei
--     aufeinanderfolgenden Warnmessungen eine Benachrichtigung. Bei der
--     produktiven 15-Minuten-Pruefung entspricht das etwa 30 Minuten seit
--     dem ersten Befund (Messung 1, 2 nach 15 min, 3 nach 30 min).
--   * ROT ist ein echter Stoerfall und wird bereits bei der ersten kritischen
--     Messung alarmiert.
--   * Offene Warnungen werden weiterhin nicht stuendlich wiederholt.
--
-- Die Alarmfunktion liest diese Werte dynamisch aus kc_system_check_alarm_policy.
-- Es wird keine Tabellenstruktur geaendert.
update public.kc_system_check_alarm_policy
set policy = jsonb_set(
               jsonb_set(policy, '{confirmAfter,critical}', '1'::jsonb, true),
               '{confirmAfter,warning}', '3'::jsonb, true
             ),
    updated_at = now()
where id = 'default';
