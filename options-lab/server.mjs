import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {screenContract,scoreContract,scoreSetup} from './risk.mjs';
import {initJournal,listJournal,mergeJournal,deleteJournal,closePaperTrade} from './paper-journal.mjs';
import {paperExitDecision,paperEntryCandidate} from './paper-strategy.mjs';
import {performanceMetrics} from './performance.mjs';
let journalReady=false;
initJournal().then(ready=>{journalReady=ready;console.log('Paper journal database:',ready?'ready':'not configured')}).catch(error=>console.error('Paper journal initialization failed:',error.message));
const base=process.env.MARKET_DESK_BACKEND_URL||'https://market-desk-paper-scanner.onrender.com';
const secret=process.env.SCANNER_SHARED_SECRET;
const access=process.env.OPTIONS_LAB_ACCESS_KEY;
function send(res,status,data){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data))}
async function upstream(path){if(!secret)throw Error('Market Desk backend not configured');const r=await fetch(new URL(path,base),{headers:{Authorization:'Bearer '+secret},signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Market Desk backend error '+r.status);return r.json()}
function symbol(s){if(!/^[A-Z]{1,5}$/.test(s))throw Error('Invalid symbol');return s}
function expiry(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw Error('Invalid expiry');return s}
const scanState={lastRun:null,lastError:null,lastAttempt:null,lastOutcome:'waiting',successfulScans:0,failedScans:0,candidates:[],running:false,history:[],confirmed:[],priorCandidates:[],alerts:[]};
function easternNow(){const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());const x=Object.fromEntries(parts.map(p=>[p.type,p.value]));return {weekday:x.weekday,minutes:Number(x.hour)*60+Number(x.minute)}}
async function backgroundScan(){
 if(scanState.running)return;
 scanState.running=true;
 scanState.lastAttempt=new Date().toISOString();
 scanState.lastOutcome='running';
 try{
  const active=await upstream('/most-active');
  const symbols=[...new Set((active.stocks||[]).filter(x=>x.optionsEligible===true).map(x=>x.symbol))].slice(0,30);
  if(!symbols.length)throw Error('No optionable candidates');
  const qs=new URL('/quotes',base);qs.searchParams.set('symbols',symbols.join(','));
  const snapshots=await upstream(qs.pathname+qs.search);
  const stocks=(snapshots.quotes||[]).filter(x=>!x.unavailable&&Number.isFinite(x.price)&&Number.isFinite(x.changePercent)&&Math.abs(x.changePercent)>=0.75).sort((a,b)=>Math.abs(b.changePercent)-Math.abs(a.changePercent)).slice(0,10);
  const checkedAt=new Date().toISOString();
  const results=await Promise.all(stocks.map(async stock=>{
   try{
    const e=new URL('/expirations',base);e.searchParams.set('symbol',stock.symbol);
    const ex=await upstream(e.pathname+e.search);
    const dateParts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const dateFields=Object.fromEntries(dateParts.map(p=>[p.type,p.value]));const today=dateFields.year+'-'+dateFields.month+'-'+dateFields.day;
    const dates=(ex.expirations||[]).filter(d=>{const diff=(Date.parse(d+'T12:00:00Z')-Date.parse(today+'T12:00:00Z'))/86400000;return diff>=0&&diff<=10});
    if(!dates.length)return null;
    const side=stock.changePercent>0?'call':'put';
    const target=new URL('/chain',base);Object.entries({symbol:stock.symbol,expiry:dates[0],side}).forEach(([k,v])=>target.searchParams.set(k,v));
    const chain=await upstream(target.pathname+target.search);
    const eligible=(chain.contracts||[]).map(c=>({...c,screen:scoreContract({...c,expiry:dates[0]},{underlyingPrice:stock.price})})).filter(c=>c.screen.eligible&&Number.isFinite(c.strike)&&Math.abs(c.strike-stock.price)/stock.price<=0.08).sort((a,b)=>b.screen.score-a.screen.score);
    if(!eligible.length)return null;
    const c=eligible[0];
    const barsUrl=new URL('/bars',base);barsUrl.searchParams.set('symbol',stock.symbol);barsUrl.searchParams.set('range','1D');
    const intraday=await upstream(barsUrl.pathname+barsUrl.search);
    const bars=(intraday.bars||[]).filter(b=>Number.isFinite(b.h)&&Number.isFinite(b.l)&&Number.isFinite(b.c));
    const previous=bars.slice(-13,-1);
    const last=bars.at(-1);
    if(previous.length<8||!last||!Number.isFinite(Date.parse(last.t))||Date.now()-Date.parse(last.t)>180000)return null;
    const recentHigh=Math.max(...previous.map(b=>b.h)),recentLow=Math.min(...previous.map(b=>b.l));
    const isBreakout=side==='call'?last.c>recentHigh:last.c<recentLow;
    const volumeAverage=previous.reduce((n,b)=>n+(Number(b.v)||0),0)/previous.length;
    const volumeConfirmed=volumeAverage>0&&Number(last.v)>=volumeAverage*1.3;
    const volumeRatio=volumeAverage>0?Number(last.v)/volumeAverage:null;
    const setup=scoreSetup({quoteScore:c.screen.score,changePercent:stock.changePercent,volumeRatio,breakoutConfirmed:isBreakout&&volumeConfirmed});
    const range=Math.max(0.01,recentHigh-recentLow);
    const stopLevel=side==='call'?Number((last.c-range*.5).toFixed(2)):Number((last.c+range*.5).toFixed(2));
    const targetLevel=side==='call'?Number((last.c+range).toFixed(2)):Number((last.c-range).toFixed(2));
    return {id:stock.symbol+'-'+dates[0]+'-'+side+'-'+c.strike,symbol:stock.symbol,side,expiry:dates[0],strike:c.strike,ask:c.ask,bid:c.bid,underlying:stock.price,changePercent:stock.changePercent,spreadPct:c.screen.spreadPct,premiumDollars:c.screen.premiumDollars,quoteTime:c.quoteTime,checkedAt,classification:isBreakout&&volumeConfirmed?'BREAKOUT_WATCH':'DEVELOPING_WATCH',setup,breakoutLevel:side==='call'?recentHigh:recentLow,stopLevel,targetLevel,volumeRatio:volumeRatio===null?null:Number(volumeRatio.toFixed(2)),barTime:last.t,reason:isBreakout&&volumeConfirmed?'Intraday breakout with 1.3x recent volume; research only.':'Developing setup; breakout and volume not both confirmed. Research only.'};
   }catch{return null}
  }));
  const current=results.filter(Boolean);
  const prior=new Map(scanState.priorCandidates.map(c=>[c.id,c]));
  const confirmed=current.filter(c=>c.classification==='BREAKOUT_WATCH'&&prior.get(c.id)?.classification==='BREAKOUT_WATCH'&&Math.sign(prior.get(c.id).changePercent)===Math.sign(c.changePercent));
  scanState.confirmed=confirmed.map(c=>({...c,classification:'CONFIRMED_BREAKOUT_WATCH',reason:'Intraday breakout and volume condition persisted over two scans. Still a research alert, not a verified executable entry or guarantee.'}));
  // Simulated entries only: confirmed two-scan breakouts, fresh ask, one contract.
  if(journalReady){
   try{
    const existing=await listJournal();
    const existingIds=new Set(existing.map(t=>t.id));
    const entries=[];
    for(const c of scanState.confirmed){
     const entry=paperEntryCandidate(c,existingIds,checkedAt);
     if(!entry)continue;
     entries.push(entry);
     const id=entry.id;
     existingIds.add(id);
     if(entries.length>=3)break;
    }
    if(entries.length)await mergeJournal(entries);
   }catch(e){console.error('Paper auto-entry failed:',e.message)}
  }
  scanState.candidates=current.sort((a,b)=>b.setup.score-a.setup.score);scanState.priorCandidates=current;
  for(const c of scanState.confirmed){
   const last=scanState.alerts.find(a=>a.id===c.id&&Date.now()-Date.parse(a.checkedAt)<3600000);
   if(!last)scanState.alerts.unshift(c);
  }
  scanState.alerts=scanState.alerts.slice(0,40);
  scanState.lastRun=checkedAt;scanState.lastError=null;scanState.lastOutcome='completed';scanState.successfulScans++;
  const tiers=Object.fromEntries(['High Conviction','Actionable','Watchlist','Developing'].map(t=>[t,scanState.candidates.filter(c=>c.setup?.tier===t).length]));
  scanState.history.unshift({checkedAt,candidates:scanState.candidates.length,confirmed:scanState.confirmed.length,tiers});scanState.history=scanState.history.slice(0,100);
 }catch(e){scanState.lastError=e.message;scanState.lastOutcome='failed';scanState.failedScans++;console.error('Options Lab background scan failed:',e.message)}
 finally{scanState.running=false}
}
const scanIfMarketHours=async()=>{const t=easternNow();if(!['Mon','Tue','Wed','Thu','Fri'].includes(t.weekday)||t.minutes<570||t.minutes>=960)return;try{const state=await upstream('/state');if(state.session?.isOpen===false||state.session?.marketOpen===false)return}catch{return}void backgroundScan()};setInterval(scanIfMarketHours,300000).unref();scanIfMarketHours();
let paperExitBusy=false;
const paperExitStatus={lastCheck:null,lastError:null,checked:0,closed:0};
async function monitorPaperExits(){
 if(paperExitBusy||!journalReady)return;
 const t=easternNow();
 if(!['Mon','Tue','Wed','Thu','Fri'].includes(t.weekday)||t.minutes<570||t.minutes>=960)return;
 paperExitBusy=true;
 try{
  const state=await upstream('/state');
  if(state.session?.isOpen===false||state.session?.marketOpen===false)return;
  const trades=(await listJournal()).filter(x=>x.auto===true&&!Number.isFinite(x.exit)).slice(0,20);
  let checked=0,closed=0;
  for(const trade of trades){
   try{
    const q=new URL('/chain',base);
    for(const [k,v] of Object.entries({symbol:trade.symbol,expiry:trade.expiry,side:trade.side}))q.searchParams.set(k,v);
    const chain=await upstream(q.pathname+q.search);
    const contract=(chain.contracts||[]).find(c=>Math.abs(Number(c.strike)-Number(trade.strike))<0.001);
    if(!contract||!Number.isFinite(contract.bid)||contract.bid<0||!Number.isFinite(contract.bidSize)||contract.bidSize<1)continue;
    const reason=paperExitDecision(trade,contract);
    checked++;
    if(reason&&await closePaperTrade(trade.id,contract.bid,reason,contract.quoteTime))closed++;
   }catch{}
  }
  Object.assign(paperExitStatus,{lastCheck:new Date().toISOString(),lastError:null,checked,closed:paperExitStatus.closed+closed});
 }catch(e){paperExitStatus.lastError=e.message}
 finally{paperExitBusy=false}
}
setInterval(()=>{void monitorPaperExits()},60000).unref();
setTimeout(()=>{void monitorPaperExits()},5000);
createServer(async(req,res)=>{const u=new URL(req.url,'http://localhost');
if(u.pathname==='/health')return send(res,200,{ok:true,configured:!!secret&&!!access});
if(req.method==='GET'&&['/','/index.html','/app.js'].includes(u.pathname)){res.writeHead(200,{'content-type':u.pathname==='/app.js'?'text/javascript':'text/html','cache-control':'no-store'});return res.end(await readFile(new URL(u.pathname==='/app.js'?'./app.js':'./index.html',import.meta.url)))}
if(!access)return send(res,503,{error:'Access not configured'});
if(req.headers['x-options-lab-key']!==access)return send(res,401,{error:'Unauthorized'});
try{
if(u.pathname==='/api/paper-journal'){
 if(!journalReady)return send(res,503,{error:'Paper journal database not ready'});
 if(req.method==='GET')return send(res,200,{trades:await listJournal(),durable:true});
 if(req.method==='DELETE'){
  let raw='';for await(const part of req){raw+=part;if(raw.length>200000)return send(res,413,{error:'Request too large'})}
  return send(res,200,await deleteJournal(JSON.parse(raw).ids));
 }
 if(req.method==='POST'){
  let raw='';for await(const part of req){raw+=part;if(raw.length>2000000)return send(res,413,{error:'Journal batch too large'})}
  const result=await mergeJournal(JSON.parse(raw).trades);
  return send(res,200,{...result,durable:true});
 }
}
if(req.method==='GET'&&u.pathname==='/api/performance'){
 if(!journalReady)return send(res,503,{error:'Paper journal database not ready'});
 return send(res,200,{...performanceMetrics(await listJournal()),source:'postgres',hypothetical:true,notice:'One-contract hypothetical premiums before fees and slippage. No actual orders.'});
}
if(req.method==='GET'&&u.pathname==='/api/monitor'){
 return send(res,200,{...scanState,paperExits:paperExitStatus,storage:{paperJournal:journalReady?'postgres':'browser-only',durable:journalReady},notice:'Intraday breakout and volume filters with two-scan confirmation. No live trade execution, guaranteed fills, persistent paper fills or closed-app push. Scan state resets when server restarts.'});
}
if(req.method==='GET'&&u.pathname==='/api/scanner'){
 const active=await upstream('/most-active');
 const symbols=[...new Set((active.stocks||[]).filter(x=>x.optionsEligible!==false).map(x=>x.symbol))].slice(0,20);
 const q=new URL('/quotes',base);q.searchParams.set('symbols',symbols.join(','));
 const snapshots=symbols.length?await upstream(q.pathname+q.search):{quotes:[],checkedAt:null};
 const bySymbol=new Map((active.stocks||[]).map(x=>[x.symbol,x]));
 const ranked=(snapshots.quotes||[]).filter(x=>!x.unavailable&&Number.isFinite(x.changePercent)).map(x=>({
  ...x,name:bySymbol.get(x.symbol)?.name||x.symbol,
  volume:bySymbol.get(x.symbol)?.volume??x.volume??null,
  optionsEligible:bySymbol.get(x.symbol)?.optionsEligible??null,
  volatilityProxyPct:Math.abs(x.changePercent)
 })).sort((a,b)=>b.volatilityProxyPct-a.volatilityProxyPct);
 return send(res,200,{quotes:ranked,checkedAt:snapshots.checkedAt||active.checkedAt||null,source:'Alpaca SIP most-active + stock snapshots',note:'Dynamic candidates ranked by absolute daily % change among Alpaca top-volume stocks. Not a full-market realized-volatility ranking or a validated options signal. Updates when refreshed; may reflect prior session outside market hours.'});
}
if(req.method==='GET'&&u.pathname==='/api/opportunities'){
 const active=await upstream('/most-active');
 const symbols=[...new Set((active.stocks||[]).filter(x=>x.optionsEligible===true).map(x=>x.symbol))].slice(0,24);
 if(!symbols.length)return send(res,200,{candidates:[],checkedAt:new Date().toISOString(),note:'No options-enabled high-volume candidates returned.'});
 const qs=new URL('/quotes',base);qs.searchParams.set('symbols',symbols.join(','));
 const snapshots=await upstream(qs.pathname+qs.search);
 const movers=(snapshots.quotes||[]).filter(x=>!x.unavailable&&Number.isFinite(x.price)&&Number.isFinite(x.changePercent)).sort((a,b)=>Math.abs(b.changePercent)-Math.abs(a.changePercent)).slice(0,10);
 const results=await Promise.all(movers.map(async stock=>{
  try{
   const e=new URL('/expirations',base);e.searchParams.set('symbol',stock.symbol);
   const ex=await upstream(e.pathname+e.search);
   const dates=ex.expirations||[];
   const now=Date.now();
   const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
   const et=Object.fromEntries(parts.map(p=>[p.type,p.value]));
   const today=`${et.year}-${et.month}-${et.day}`;
   const expiryDates=dates.filter(d=>{if(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d))return false;const days=(Date.parse(d+'T12:00:00Z')-Date.parse(today+'T12:00:00Z'))/86400000;return days>=0&&days<=10}).slice(0,2);
   const expiryDate=expiryDates[0];
   if(!expiryDate)return {symbol:stock.symbol,changePercent:stock.changePercent,reason:'No expiration within 10 days',contracts:[]};
   const chains=await Promise.all(expiryDates.flatMap(date=>['call','put'].map(async side=>{const c=new URL('/chain',base);Object.entries({symbol:stock.symbol,expiry:date,side}).forEach(([k,v])=>c.searchParams.set(k,v));try{return {side,date,data:await upstream(c.pathname+c.search)}}catch{return {side,date,data:{contracts:[]}}}})));
   const contracts=chains.flatMap(({side,date,data})=>(data.contracts||[]).map(c=>({...c,side,expiry:date,screen:scoreContract({...c,expiry:date},{underlyingPrice:stock.price})}))).filter(c=>c.screen.eligible).sort((a,b)=>b.screen.score-a.screen.score||a.screen.spreadPct-b.screen.spreadPct).slice(0,8);
   const ranked=contracts.map(c=>({...c,setup:scoreSetup({quoteScore:c.screen.score,changePercent:stock.changePercent})})).sort((a,b)=>b.setup.score-a.setup.score||b.screen.score-a.screen.score);
   return {symbol:stock.symbol,price:stock.price,changePercent:stock.changePercent,expiry:expiryDate,contracts:ranked};
  }catch(e){return {symbol:stock.symbol,changePercent:stock.changePercent,reason:'Data unavailable',contracts:[]}}
 }));
 return send(res,200,{candidates:results,checkedAt:new Date().toISOString(),note:'Expanded discovery across up to 24 active stocks, 10 movers, two near-term expirations and both option sides. Quote quality and separate momentum-aware setup ranking. Unconfirmed setups are capped below High Conviction; no breakout or relative volume is assumed. Research only, not a probability of profit or trade recommendation. Quotes may become stale immediately; recheck before acting.'});
}
if(req.method==='GET'&&u.pathname==='/api/market-status'){
 const j=await upstream('/state');
 const session=j.session||{};
 return send(res,200,{session,checkedAt:j.lastCheck||null,source:'Market Desk / Alpaca exchange calendar',note:'Today session is exchange-calendar based; next trading day after a closure is estimated until verified by calendar.'});
}
if(req.method==='GET'&&u.pathname==='/api/ticker-search'){
 const q=(u.searchParams.get('q')||'').trim().slice(0,60);
 if(q.length<1)return send(res,200,{results:[]});
 const target=new URL('/search',base);target.searchParams.set('q',q);
 const j=await upstream(target.pathname+target.search);
 return send(res,200,{results:(j.results||[]).slice(0,10)});
}
if(req.method==='GET'&&u.pathname==='/api/stock-quote'){
 const target=new URL('/quotes',base);target.searchParams.set('symbols',symbol(u.searchParams.get('symbol')));
 const j=await upstream(target.pathname+target.search);
 return send(res,200,{quote:(j.quotes||[])[0]||null,checkedAt:j.checkedAt||null,source:j.source||'Alpaca SIP'});
}
if(req.method==='GET'&&u.pathname==='/api/expirations'){const q=new URL('/expirations',base);q.searchParams.set('symbol',symbol(u.searchParams.get('symbol')));return send(res,200,await upstream(q.pathname+q.search))}
if(req.method==='GET'&&u.pathname==='/api/paper-quote'){
 const sym=symbol(u.searchParams.get('symbol')),date=expiry(u.searchParams.get('expiry')),side=u.searchParams.get('side'),strike=Number(u.searchParams.get('strike'));
 if(!['call','put'].includes(side)||!Number.isFinite(strike)||strike<=0)return send(res,400,{error:'Invalid paper contract'});
 const q=new URL('/chain',base);for(const [k,v] of Object.entries({symbol:sym,expiry:date,side}))q.searchParams.set(k,v);
 const chain=await upstream(q.pathname+q.search);
 const c=(chain.contracts||[]).find(x=>Math.abs(Number(x.strike)-strike)<0.001);
 if(!c||!Number.isFinite(c.bid)||c.bid<=0||!Number.isFinite(c.ask)||c.ask<c.bid||!Number.isFinite(c.bidSize)||c.bidSize<=0||!Number.isFinite(c.askSize)||c.askSize<=0)return send(res,200,{available:false,reason:'Incomplete or invalid option quote'});
 const age=Date.now()-Date.parse(c.quoteTime);
 return send(res,200,{available:Number.isFinite(age)&&age>=-5000&&age<=30000,bid:c.bid,ask:c.ask,quoteTime:c.quoteTime,bidSize:c.bidSize,ageMs:age,source:'Alpaca OPRA; indicative, not executable'});
}
if(req.method==='GET'&&u.pathname==='/api/chain'){const sym=symbol(u.searchParams.get('symbol')),date=expiry(u.searchParams.get('expiry')),side=u.searchParams.get('side');if(!['call','put'].includes(side))throw Error('Invalid side');const q=new URL('/chain',base);for(const [k,v] of Object.entries({symbol:sym,expiry:date,side}))q.searchParams.set(k,v);const j=await upstream(q.pathname+q.search);return send(res,200,{...j,screened:(j.contracts||[]).map(c=>({...c,screen:screenContract({...c,expiry:date})}))})}
return send(res,404,{error:'Not found'})
}catch(e){send(res,400,{error:e.message})}
}).listen(Number(process.env.PORT||10000),'0.0.0.0');