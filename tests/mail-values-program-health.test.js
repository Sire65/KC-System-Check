import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync('supabase/migrations/202609081730_kc_mailwerte_und_programmfehler_semantik.sql','utf8');

test('KC System Check Alarmmail zeigt Gesamtwerte des Prüflaufs',()=>{
  assert.match(sql,/kc_system_check_alert_v2/);
  assert.match(sql,/Gesamtgesundheit: \{\{health\}\} %/);
  assert.match(sql,/Prüfabdeckung: \{\{coverage\}\} %/);
  assert.match(sql,/Prüfzeitpunkt: \{\{timestamp\}\}/);
  assert.match(sql,/event_key in \('system_error', 'system_warning', 'system_recovered'\)/);
});

test('ONLINE plus kumulativer error_count ist keine aktuelle Störung',()=>{
  assert.match(sql,/upper\(coalesce\(status,''\)\) not in \('ONLINE','OK','HEALTHY','RUNNING','IDLE'\)/);
  assert.match(sql,/fehler_seit_start/);
  assert.match(sql,/ERROR','CRITICAL','DEGRADED','WARNING','FAILED','FAIL','OFFLINE/);
});
