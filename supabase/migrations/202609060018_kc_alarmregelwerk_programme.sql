-- Die Programmaufstellung wird aus KC Core gelesen. Ist KC Core weg, ist sie
-- nicht abrufbar - dann meldet die Ursache und nicht beides.
insert into public.kc_system_check_alarm_policy (id, policy)
values ('default', '{
  "note": "Alarmregeln als Konfiguration, nicht als Code. dependencies nennt je Signal die Voraussetzungen: faellt eine davon aus, ist das Signal ein Folgealarm und wird unterdrueckt. renotifyStatuses bestimmt, welche Zustaende nach renotifyAfterMinutes erneut gemeldet werden - eine offene Warnung ist eine Aufgabe, kein Vorfall, und wird nicht stuendlich wiederholt.",
  "confirmAfter": {
    "critical": 2,
    "warning": 2,
    "unknown": 3,
    "healthy": 3
  },
  "renotifyAfterMinutes": 60,
  "renotifyStatuses": [
    "critical"
  ],
  "escalateAfterMinutes": 15,
  "dependencies": {
    "mirror": [
      "kc_core",
      "neon"
    ],
    "backup": [
      "neon"
    ],
    "db_security": [
      "kc_core"
    ],
    "db_capacity": [
      "kc_core"
    ],
    "programs": [
      "kc_core"
    ],
    "future_academy": [],
    "neon": [],
    "b2": [],
    "r2": [],
    "oci": [],
    "github": [],
    "endpoint_exposure": [],
    "key_lifetime": []
  }
}'::jsonb)
on conflict (id) do update set policy = excluded.policy, updated_at = now();
