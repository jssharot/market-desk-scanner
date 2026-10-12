import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSymbols,normalizeSnapshot,contractSymbol,createMarket} from './market.mjs';
const setup=(data,api=async()=>[])=>createMarket({data,api,store:{},save:async()=>{},pushEnv:{}});
test('snapshots preserve quote timestamp and do not invent missing prices',()=>{
 const now=Date.parse('2026-10-12T15:00:00Z');assert.equal(normalizeSnapshot('SPY',{},now).unavailable,true);
 const q=normalizeSnapshot('SPY',{latestTrade:{p:105,t:'2026-10-12T14:58:00Z'},prevDailyBar:{c:100}},now);
 assert.equal(q.price,105);assert.equal(q.change,5);assert.equal(q.stale,true);assert.equal(q.asOf,'2026-10-12T14:58:00Z');
});
test('symbol and contract inputs are constrained before provider requests',async()=>{
 assert.deepEqual(parseSymbols('spy,SPY,QQQ'),['SPY','QQQ']);assert.throws(()=>parseSymbols('../secrets'));
 assert.equal(contractSymbol({symbol:'SPY',expiry:'2026-10-16',side:'call',strike:650.5}),'SPY261016C00650500');
 const m=setup(()=>{throw Error('Provider should not be called')});await assert.rejects(m.handle({method:'GET',url:'/bars?symbol=../../x'}),/Invalid chart symbol/);
});
test('stock bars paginate and 1D selects latest regular session without filling gaps',async()=>{
 const calls=[];const bar=t=>({t,o:100,h:103,l:99,c:102,v:12});const m=setup(async(p,args)=>{calls.push(args);return args.page_token?{bars:{SPY:[bar('2026-10-12T13:30:00Z'),bar('2026-10-12T13:35:00Z'),bar('2026-10-12T20:01:00Z')]}}:{bars:{SPY:[bar('2026-10-09T13:30:00Z')]},next_page_token:'next'}});
 const r=await m.handle({method:'GET',url:'/bars?symbol=SPY&range=1D'});assert.equal(calls.length,2);assert.equal(r.bars.length,2);assert.equal(r.bars[1].t,'2026-10-12T13:35:00Z');assert.equal(calls[0].feed,'sip');
});
test('options chain retains missing quotes as null and contracts are strike-sorted',async()=>{
 const m=setup(async()=>({snapshots:{SPY261016C00660000:{},SPY261016C00650000:{latestQuote:{bp:2,ap:2.1,t:'2026-10-12T15:00Z'},greeks:{delta:.5}}}}));
 const r=await m.handle({method:'GET',url:'/chain?symbol=SPY&expiry=2026-10-16&side=call'});assert.equal(r.contracts[0].strike,650);assert.equal(r.contracts[1].bid,null);assert.equal(r.contracts[0].greeks.delta,.5);
});
test('news preserves source and detail while following pagination and symbol filters',async()=>{
 const seen=[];const m=setup(async(p,a)=>{seen.push([p,a]);return {news:[{id:123,headline:'Headline',source:'Benzinga',summary:'Short',content:'<p>Long</p>',created_at:'2026-10-12T15:00Z'}],next_page_token:'n2'}});
 const list=await m.handle({method:'GET',url:'/news?symbols=SPY&page_token=n1'});assert.equal(list.nextPageToken,'n2');assert.equal(list.articles[0].source,'Benzinga');assert.equal(seen[0][1].symbols,'SPY');assert.equal(seen[0][1].page_token,'n1');assert.equal(list.articles[0].content,undefined);
 const article=await m.handle({method:'GET',url:'/news?id=123'});assert.equal(article.content,'<p>Long</p>');assert.equal(seen.length,1);assert.equal(seen[0][1].include_content,'true');
});
test('tracking ignores closed positions and uses fresh bid for liquidation estimates',async()=>{
 const store={},qtime=new Date().toISOString();const m=createMarket({store,save:async()=>{},pushEnv:{},api:async()=>[],data:async p=>p.includes('news')?{news:[]}:p.includes('stocks')?{SPY:{latestTrade:{p:650,t:qtime},prevDailyBar:{c:640}}}:{quotes:{SPY261016C00650000:{bp:2,ap:2.1,bs:1,as:1,t:qtime}}}});
 const p={id:'p1',symbol:'SPY',expiry:'2026-10-16',side:'call',strike:650,contracts:2,entryPremium:1.5,status:'open'};
 await m.setTracking({symbols:['SPY'],positions:[p,{...p,id:'closed',status:'closed'}]});await m.background();const r=await m.handle({method:'GET',url:'/tracking'});assert.equal(r.positions.length,1);assert.equal(r.positions[0].liveMark.pnl,100);assert.equal(r.positions[0].liveMark.liquidationValue,400);assert.ok(r.checkedAt);
});
