import test from 'node:test';
import assert from 'node:assert/strict';
import {screenContract,rankContracts,scoreContract,scoreSetup} from './risk.mjs';
const now=Date.parse('2026-10-29T15:00:00Z');
const valid={symbol:'MSFT261030C00450000',expiry:'2026-10-30',bid:3.9,ask:4,bidSize:5,askSize:8,quoteTime:'2026-10-29T14:59:50Z'};
test('qualifies liquid fresh short-term contract',()=>assert.equal(screenContract(valid,{now}).eligible,true));
test('rejects stale quotes',()=>assert.ok(screenContract({...valid,quoteTime:'2026-10-29T14:00:00Z'},{now}).reasons.includes('stale-quote')));
test('rejects oversized premium',()=>assert.ok(screenContract({...valid,ask:11,bid:10.8},{now}).reasons.includes('premium-budget')));
test('rejects longer expirations',()=>assert.ok(screenContract({...valid,expiry:'2026-11-20'},{now}).reasons.includes('expiration')));
test('does not invent qualifying trades',()=>assert.deepEqual(rankContracts([{...valid,ask:15}],{now}),[]));

test('rejects zero or negative ask and premium',()=>{
  for(const ask of [0,-1]){
    const result=screenContract({...valid,bid:ask,ask},{now});
    assert.equal(result.eligible,false);
    assert.ok(result.reasons.includes('invalid-quote'));
    assert.ok(result.reasons.includes('premium-budget'));
  }
});
test('uses New York trading date near UTC midnight',()=>{
  const late=Date.parse('2026-10-30T01:00:00Z'); // Oct 29 at 9 PM ET
  const result=screenContract({...valid,quoteTime:'2026-10-30T00:59:50Z'},{now:late});
  assert.equal(result.dte,1);
  assert.equal(result.eligible,true);
});
test('rejects malformed expiration dates',()=>{
  assert.ok(screenContract({...valid,expiry:'not-a-date'},{now}).reasons.includes('expiration'));
});

test('scores eligible contracts with transparent factors and tiers',()=>{
 const result=scoreContract({...valid,strike:450},{underlyingPrice:451,now});
 assert.equal(result.eligible,true);
 assert.ok(result.score>=0&&result.score<=100);
 assert.equal(result.factors.length,5);
 assert.ok(['High Conviction','Actionable','Watchlist','Rejected'].includes(result.tier));
});
test('rejects invalid contracts rather than assigning actionable scores',()=>{
 const result=scoreContract({...valid,ask:12},{underlyingPrice:450,now});
 assert.equal(result.eligible,false);
 assert.equal(result.score,0);
 assert.equal(result.tier,'Rejected');
});
test('rewards tighter spreads and stronger quote depth',()=>{
 const strong=scoreContract({...valid,bid:3.98,bidSize:16,askSize:16,strike:450},{underlyingPrice:450,now});
 const weak=scoreContract({...valid,bid:3.75,bidSize:1,askSize:1,strike:450},{underlyingPrice:450,now});
 assert.ok(strong.score>weak.score);
});

test('momentum-only setups never claim high conviction',()=>{
 const s=scoreSetup({quoteScore:100,changePercent:9});
 assert.equal(s.confirmation,'momentum-only');
 assert.ok(s.score<80);
});
test('higher momentum increases setup ranking without inventing volume',()=>{
 const a=scoreSetup({quoteScore:70,changePercent:0.5});
 const b=scoreSetup({quoteScore:70,changePercent:3});
 assert.ok(b.score>a.score);
 assert.equal(b.factors.find(x=>x.name==='Relative bar volume').points,0);
});
test('invalid quotes are rejected by setup ranking',()=>{
 assert.equal(scoreSetup({quoteScore:0,changePercent:8}).tier,'Rejected');
});
