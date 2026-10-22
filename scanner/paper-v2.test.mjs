import {test} from 'node:test';import assert from 'node:assert/strict';import {assessV2,compareVersions,V2_RULES} from './paper-v2.mjs';
const signal={setup:'Trend pullback',volumeRatio:2.2,underlying:100,risk:1,target:102};
const contract={ask:3,bid:2.96,spread:0.0134,greeks:{delta:0.5},dte:14};
test('v2 qualification accepts liquid low-risk candidate',()=>{const r=assessV2(signal,contract);assert.equal(r.qualified,true);assert.equal(r.version,V2_RULES.version)});
test('v2 blocks excessive premium, risk, spreads, volume, events and exposure',()=>{const r=assessV2({...signal,volumeRatio:1.5},{...contract,ask:20,spread:0.05},{eventRisk:true,existing:[{status:'open',version:V2_RULES.version}]});for(const reason of ['pullback-volume','premium-budget','spread','risk-budget','scheduled-event-risk','portfolio-exposure'])assert(r.reasons.includes(reason))});
test('dashboard does not fabricate v2 returns',()=>{const r=compareVersions([{status:'closed',pnl:-20},{status:'closed',pnl:10}],[assessV2(signal,contract)]);assert.equal(r.v1.netPnl,-10);assert.equal(r.v2.netPnl,null);assert.equal(r.v2.qualified,1)});
