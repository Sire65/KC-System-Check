import test from 'node:test';
import assert from 'node:assert/strict';

const TRACEPARENT_RE = /^[\da-f]{2}-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/i;
function valid(v){if(!v||!TRACEPARENT_RE.test(v))return false;const[,t,p]=v.split('-');return !/^0{32}$/i.test(t)&&!/^0{16}$/i.test(p)}
function traced(url,own,headers,trace){
  const out={...headers};
  if(!trace?.traceparent)return out;
  try{if(new URL(url).origin!==new URL(own).origin)return out}catch{return out}
  return {...out,...trace};
}

const tp='00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

test('edge trace accepts a valid W3C traceparent',()=>assert.equal(valid(tp),true));
test('edge trace rejects zero trace id',()=>assert.equal(valid('00-00000000000000000000000000000000-00f067aa0ba902b7-01'),false));
test('edge trace rejects zero parent id',()=>assert.equal(valid('00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01'),false));
test('edge trace rejects malformed input',()=>assert.equal(valid('secret-or-invalid-value'),false));
test('Supabase trace preserves authorization and apikey',()=>{
  const h=traced('https://kc.supabase.co/rest/v1/rpc/check','https://kc.supabase.co',{Authorization:'Bearer service',apikey:'key'},{traceparent:tp});
  assert.equal(h.Authorization,'Bearer service');assert.equal(h.apikey,'key');assert.equal(h.traceparent,tp);
});
test('trace is not forwarded to external providers',()=>{
  for(const url of ['https://api.github.com/repos/x/y','https://neon.example/sql','https://s3.us-west-004.backblazeb2.com/file']){
    const h=traced(url,'https://kc.supabase.co',{Authorization:'Bearer external'},{traceparent:tp,baggage:'kc=test'});
    assert.equal(h.traceparent,undefined);assert.equal(h.baggage,undefined);assert.equal(h.Authorization,'Bearer external');
  }
});
test('malformed destination never receives trace',()=>{
  const h=traced('not a url','https://kc.supabase.co',{apikey:'key'},{traceparent:tp});
  assert.deepEqual(h,{apikey:'key'});
});
