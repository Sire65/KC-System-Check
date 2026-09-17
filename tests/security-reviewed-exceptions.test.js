import test from 'node:test';import assert from 'node:assert/strict';import{splitReviewedFindings}from'../js/security-reviewed-exceptions.js';
const f={object_schema:'public',object_name:'kc_dp_report_error',finding_code:'security_definer_anon_execute'};const e={...f,decision:'accepted_required',active:true,review_after:'2027-03-16T18:00:00Z'};const now=Date.parse('2026-09-17T20:00:00Z');
test('missing registry fails open',()=>assert.equal(splitReviewedFindings([f],[],now).actionable.length,1));
test('accepted review stays visible but non-actionable',()=>{const r=splitReviewedFindings([f],[e],now);assert.equal(r.findings.length,1);assert.equal(r.reviewed.length,1);assert.equal(r.actionable.length,0)});
test('expired review fails open',()=>assert.equal(splitReviewedFindings([f],[{...e,review_after:'2026-09-17T19:00:00Z'}],now).actionable.length,1));
test('fixed finding remains actionable',()=>assert.equal(splitReviewedFindings([f],[{...e,decision:'fixed'}],now).actionable.length,1));
test('unrelated finding is unchanged',()=>assert.equal(splitReviewedFindings([{...f,object_name:'other'}],[e],now).actionable.length,1));
