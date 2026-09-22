import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src=fs.readFileSync('supabase/functions/kc-edge-health/index.ts','utf8');

test('Cloudflare edge adapter is read-only and server-side',()=>{
  assert.match(src,/CLOUDFLARE_ACCOUNT_ID/);
  assert.match(src,/CLOUDFLARE_API_TOKEN/);
  assert.match(src,/Authorization:\`Bearer/);
  assert.doesNotMatch(src,/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
});

test('Cloudflare adapter checks Workers, Hyperdrive and current KV API path',()=>{
  assert.match(src,/workers\/scripts/);
  assert.match(src,/hyperdrive\/configs/);
  assert.match(src,/storage\/kv\/namespaces/);
});

test('Missing Cloudflare configuration stays neutral',()=>{
  assert.match(src,/status:"not_configured"/);
  assert.match(src,/worker:"not_configured"/);
  assert.match(src,/hyperdrive:"not_configured"/);
  assert.match(src,/kv:"not_configured"/);
});

test('Cloudflare response never returns the API token',()=>{
  assert.doesNotMatch(src,/TOKEN[,}]/);
  assert.doesNotMatch(src,/json\([^\n]*TOKEN/,'API token must never be serialized into a response');
});
