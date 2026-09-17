import test from 'node:test';
import assert from 'node:assert/strict';

const TRACEPARENT_RE = /^[\da-f]{2}-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/i;
function valid(v){if(!v||!TRACEPARENT_RE.test(v))return false;const[,t,p]=v.split('-');return !/^0{32}$/i.test(t)&&!/^0{16}$/i.test(p)}

test('edge trace accepts a valid W3C traceparent',()=>assert.equal(valid('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'),true));
test('edge trace rejects zero trace id',()=>assert.equal(valid('00-00000000000000000000000000000000-00f067aa0ba902b7-01'),false));
test('edge trace rejects zero parent id',()=>assert.equal(valid('00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01'),false));
test('edge trace rejects malformed input',()=>assert.equal(valid('secret-or-invalid-value'),false));
