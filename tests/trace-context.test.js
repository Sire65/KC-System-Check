import assert from 'node:assert/strict';
import { validTraceparent, traceHeaders, withTraceHeaders } from '../js/trace-context.js';

const valid='00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
assert.equal(validTraceparent(valid), true);
assert.equal(validTraceparent(''), false);
assert.equal(validTraceparent('00-00000000000000000000000000000000-00f067aa0ba902b7-01'), false);
assert.equal(validTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01'), false);

assert.deepEqual(traceHeaders({}), {});
assert.deepEqual(withTraceHeaders({Authorization:'Bearer existing'}, {}), {Authorization:'Bearer existing'});
assert.deepEqual(withTraceHeaders({Authorization:'Bearer existing'}, {traceparent:valid}), {
  Authorization:'Bearer existing', traceparent:valid
});
assert.deepEqual(traceHeaders({traceparent:'ungueltig', baggage:'secret=should-not-pass'}), {});
assert.deepEqual(traceHeaders({traceparent:valid, tracestate:'vendor=value', baggage:'kc.component=system-check'}), {
  traceparent:valid, tracestate:'vendor=value', baggage:'kc.component=system-check'
});
assert.equal(Object.hasOwn(withTraceHeaders({x:'y'}, {}), 'traceparent'), false);

const edge = (await import('node:fs')).readFileSync('supabase/functions/kc-system-check/index.ts','utf8');
assert.match(edge, /traceparent, tracestate, baggage/);
assert.match(edge, /const trace=\{traceparent:req\.headers\.get\("traceparent"\)/);
assert.match(edge, /headers:withTraceHeaders\(init\.headers\|\|\{\},trace\)/);
assert.doesNotMatch(edge, /let activeTrace|var activeTrace/);
assert.doesNotMatch(edge, /randomUUID\(\).*trace|trace.*randomUUID\(/i);

console.log('trace-context: OK');
