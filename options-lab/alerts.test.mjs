import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOpportunityAlert,shouldNotify} from './alerts.mjs';
const a=buildOpportunityAlert({id:'signal-1',contract:'MSFT261030C00450000',quoteTime:'2026-10-29T14:00:00Z',entry:4,stop:3,target:6,validUntil:'2026-10-29T14:02:00Z',source:'Alpaca OPRA'});
test('candidate requires recheck',()=>assert.equal(a.requiresFreshQuoteRecheck,true));
test('expired alerts do not notify',()=>assert.equal(shouldNotify(a,{now:Date.parse('2026-10-29T14:03:00Z')}),false));
test('duplicate alerts do not notify',()=>assert.equal(shouldNotify(a,{now:Date.parse('2026-10-29T14:01:00Z'),seenIds:new Set(['signal-1'])}),false));

test('rejects invalid quote timestamp',()=>assert.throws(()=>buildOpportunityAlert({id:'bad-quote',contract:'MSFT',quoteTime:'not-a-date',entry:4,stop:3,target:6,validUntil:'2026-10-29T14:02:00Z',source:'Alpaca OPRA'}),/Invalid alert timestamps/));
test('rejects invalid expiry timestamp',()=>assert.throws(()=>buildOpportunityAlert({id:'bad-expiry',contract:'MSFT',quoteTime:'2026-10-29T14:00:00Z',entry:4,stop:3,target:6,validUntil:'invalid',source:'Alpaca OPRA'}),/Invalid alert timestamps/));
