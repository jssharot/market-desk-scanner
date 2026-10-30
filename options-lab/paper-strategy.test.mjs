import test from 'node:test';
import assert from 'node:assert/strict';
import {paperEntryCandidate,paperExitDecision} from './paper-strategy.mjs';
const now=Date.parse('2026-10-30T14:00:00Z');
const stamp=new Date(now).toISOString();
const c={id:'MSFT-2026-11-06-call-450',symbol:'MSFT',side:'call',expiry:'2026-11-06',strike:450,ask:2,bid:1.95,spreadPct:2.5,quoteTime:stamp,setup:{tier:'Actionable',score:80}};
test('confirmed entry is hypothetical and bounded',()=>{
 const t=paperEntryCandidate(c,new Set(),stamp,now);
 assert.equal(t.entry,2);assert.equal(t.auto,true);assert.equal(t.source,'server-confirmed-breakout');assert.equal(t.id,'server-auto-'+c.id+'-2026-10-30');
 assert.equal(paperEntryCandidate(c,new Set([t.id]),stamp,now),null);
});
test('entry rejects stale, expensive, and weak signals',()=>{
 assert.equal(paperEntryCandidate({...c,ask:11},new Set(),stamp,now),null);
 assert.equal(paperEntryCandidate({...c,setup:{tier:'Developing'}},new Set(),stamp,now),null);
 assert.equal(paperEntryCandidate({...c,quoteTime:new Date(now-40000).toISOString()},new Set(),stamp,now),null);
});
test('paper exits require fresh bid with depth',()=>{
 const t={entry:2};
 assert.equal(paperExitDecision(t,{bid:1.4,bidSize:2,quoteTime:stamp},now),'Paper stop (-30%)');
 assert.equal(paperExitDecision(t,{bid:3,bidSize:2,quoteTime:stamp},now),'Paper target (+50%)');
 assert.equal(paperExitDecision(t,{bid:2,bidSize:2,quoteTime:stamp},now),null);
 assert.equal(paperExitDecision(t,{bid:1,bidSize:0,quoteTime:stamp},now),null);
 assert.equal(paperExitDecision({...t,exit:3},{bid:1,bidSize:2,quoteTime:stamp},now),null);
});
