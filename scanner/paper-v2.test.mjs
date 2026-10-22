import {test} from 'node:test';import assert from 'node:assert/strict';import {assessV2,compareVersions,V2_RULES,openV2,exitReasonV2,closeV2,selectV2Contract} from './paper-v2.mjs';
const now=Date.parse('2026-10-22T15:00:00Z'),signal={id:'paper-v1:sample',symbol:'SPY',side:'call',setup:'Trend pullback',volumeRatio:2.2,underlying:100,risk:1,stop:99,target:102};
const contract={symbol:'SPY261106C00100000',ask:3,bid:2.96,spread:0.0134,greeks:{delta:0.5},dte:14};
const quote=bp=>({bp,ap:bp+.04,bs:10,as:10,t:new Date(now).toISOString()});
test('v2 qualification accepts liquid low-risk candidate',()=>{const r=assessV2(signal,contract);assert.equal(r.qualified,true);assert.equal(r.version,V2_RULES.version)});
test('v2 blocks premium, risk, spreads, volume, events and exposure',()=>{const r=assessV2({...signal,volumeRatio:1.5},{...contract,ask:20,spread:0.05},{eventRisk:true,existing:[{status:'open'}]});for(const reason of ['pullback-volume','premium-budget','spread','risk-budget','scheduled-event-risk','portfolio-exposure'])assert(r.reasons.includes(reason))});
test('independent v2 stop uses option bid and simulated fill fees',()=>{const p=openV2(signal,contract,now);assert.equal(p.version,V2_RULES.version);assert.equal(exitReasonV2(p,100,quote(2.6),60,now),'V2 premium stop');const x=closeV2(p,quote(2.6),'V2 premium stop',now);assert.equal(x.status,'closed');assert(Math.abs(x.pnl-((2.59-3.01)*100-1.30))<1e-6)});
test('v2 targets, stale exits, and independent journal metrics',()=>{const p=openV2(signal,contract,now);assert.equal(exitReasonV2(p,100,quote(3.8),60,now),'V2 premium target');const pending=closeV2(p,{...quote(2),t:new Date(now-40000).toISOString()},'stop',now);assert.equal(pending.status,'open');const x=closeV2(p,quote(3.8),'V2 premium target',now);const comparison=compareVersions([{status:'closed',pnl:-20}],[x],[assessV2(signal,contract)]);assert.equal(comparison.v1.netPnl,-20);assert.equal(comparison.v2.trades,1);assert.equal(comparison.v2.qualified,1)});

test('v2 selects only contracts meeting its own tighter spread and DTE',()=>{
 const q=(bp,ap)=>({bp,ap,bs:10,as:10,t:new Date(now).toISOString()});
 const g={delta:.5,gamma:.01,theta:-.03,vega:.2};
 const chain={
  SPY261106C00100000:{latestQuote:q(2.80,3),greeks:g,impliedVolatility:.3},
  SPY261105C00100000:{latestQuote:q(2.96,3),greeks:g,impliedVolatility:.3}
 };
 const selected=selectV2Contract(chain,signal,now);
 assert.equal(selected.symbol,'SPY261105C00100000');
 assert.equal(selectV2Contract({'SPY261106C00100000':chain.SPY261106C00100000},signal,now),null);
});
