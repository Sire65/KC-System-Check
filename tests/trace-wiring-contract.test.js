import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../supabase/functions/kc-system-check/index.ts', import.meta.url), 'utf8');

test('Edge function imports the isolated Trace Context helper', () => {
  assert.match(source, /from ["']\.\/trace-context\.ts["']/);
  assert.match(source, /incomingTraceHeaders/);
  assert.match(source, /withSupabaseTrace/);
});

test('CORS explicitly permits W3C Trace Context request headers', () => {
  const cors = source.match(/Access-Control-Allow-Headers[^\n]+/)?.[0] || '';
  for (const name of ['traceparent', 'tracestate', 'baggage']) assert.match(cors, new RegExp(name, 'i'));
});

test('incoming trace is read only after own Supabase URL is known', () => {
  assert.match(source, /SUPABASE_URL[\s\S]{0,500}incomingTraceHeaders\(req\)/);
});

test('external provider calls stay outside explicit Supabase trace wrapping', () => {
  const forbidden = [
    /withSupabaseTrace\([^\n]*raw\.githubusercontent\.com/,
    /withSupabaseTrace\([^\n]*gitCfg/,
    /withSupabaseTrace\([^\n]*NEON/,
    /withSupabaseTrace\([^\n]*B2/,
    /withSupabaseTrace\([^\n]*R2/,
    /withSupabaseTrace\([^\n]*OCI/,
    /withSupabaseTrace\([^\n]*futureCfg/,
  ];
  for (const pattern of forbidden) assert.doesNotMatch(source, pattern);
});
