import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {screenContract} from './risk.mjs';
const base=process.env.MARKET_DESK_BACKEND_URL||'https://market-desk-paper-scanner.onrender.com';
const secret=process.env.SCANNER_SHARED_SECRET;
const access=process.env.OPTIONS_LAB_ACCESS_KEY;
function send(res,status,data){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data))}
async function upstream(path){if(!secret)throw Error('Market Desk backend not configured');const r=await fetch(new URL(path,base),{headers:{Authorization:'Bearer '+secret},signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Market Desk backend error '+r.status);return r.json()}
function symbol(s){if(!/^[A-Z]{1,5}$/.test(s))throw Error('Invalid symbol');return s}
function expiry(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw Error('Invalid expiry');return s}
createServer(async(req,res)=>{const u=new URL(req.url,'http://localhost');
if(u.pathname==='/health')return send(res,200,{ok:true,configured:!!secret&&!!access});
if(req.method==='GET'&&['/','/index.html','/app.js'].includes(u.pathname)){res.writeHead(200,{'content-type':u.pathname==='/app.js'?'text/javascript':'text/html','cache-control':'no-store'});return res.end(await readFile(new URL(u.pathname==='/app.js'?'./app.js':'./index.html',import.meta.url)))}
if(!access)return send(res,503,{error:'Access not configured'});
if(req.headers['x-options-lab-key']!==access)return send(res,401,{error:'Unauthorized'});
try{
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
 const symbols=[...new Set((active.stocks||[]).filter(x=>x.optionsEligible===true).map(x=>x.symbol))].slice(0,12);
 if(!symbols.length)return send(res,200,{candidates:[],checkedAt:new Date().toISOString(),note:'No options-enabled high-volume candidates returned.'});
 const qs=new URL('/quotes',base);qs.searchParams.set('symbols',symbols.join(','));
 const snapshots=await upstream(qs.pathname+qs.search);
 const movers=(snapshots.quotes||[]).filter(x=>!x.unavailable&&Number.isFinite(x.price)&&Number.isFinite(x.changePercent)).sort((a,b)=>Math.abs(b.changePercent)-Math.abs(a.changePercent)).slice(0,5);
 const results=await Promise.all(movers.map(async stock=>{
  try{
   const e=new URL('/expirations',base);e.searchParams.set('symbol',stock.symbol);
   const ex=await upstream(e.pathname+e.search);
   const dates=ex.expirations||[];
   const now=Date.now();
   const today=new Date(now).toISOString().slice(0,10);
   const expiryDate=dates.find(d=>{const days=(Date.parse(d+'T12:00:00Z')-Date.parse(today+'T12:00:00Z'))/86400000;return days>=0&&days<=10});
   if(!expiryDate)return {symbol:stock.symbol,changePercent:stock.changePercent,reason:'No expiration within 10 days',contracts:[]};
   const chains=await Promise.all(['call','put'].map(async side=>{const c=new URL('/chain',base);Object.entries({symbol:stock.symbol,expiry:expiryDate,side}).forEach(([k,v])=>c.searchParams.set(k,v));try{return {side,data:await upstream(c.pathname+c.search)}}catch{return {side,data:{contracts:[]}}}}));
   const contracts=chains.flatMap(({side,data})=>(data.contracts||[]).map(c=>({...c,side,expiry:expiryDate,screen:screenContract({...c,expiry:expiryDate})}))).filter(c=>c.screen.eligible).sort((a,b)=>a.screen.spreadPct-b.screen.spreadPct||Math.abs(a.strike-stock.price)-Math.abs(b.strike-stock.price)).slice(0,4);
   return {symbol:stock.symbol,price:stock.price,changePercent:stock.changePercent,expiry:expiryDate,contracts};
  }catch(e){return {symbol:stock.symbol,changePercent:stock.changePercent,reason:'Data unavailable',contracts:[]}}
 }));
 return send(res,200,{candidates:results,checkedAt:new Date().toISOString(),note:'Live liquidity-screened candidates, NOT validated directional signals or trade recommendations. Quotes may become stale immediately; recheck before acting.'});
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
if(req.method==='GET'&&u.pathname==='/api/chain'){const sym=symbol(u.searchParams.get('symbol')),date=expiry(u.searchParams.get('expiry')),side=u.searchParams.get('side');if(!['call','put'].includes(side))throw Error('Invalid side');const q=new URL('/chain',base);for(const [k,v] of Object.entries({symbol:sym,expiry:date,side}))q.searchParams.set(k,v);const j=await upstream(q.pathname+q.search);return send(res,200,{...j,screened:(j.contracts||[]).map(c=>({...c,screen:screenContract({...c,expiry:date})}))})}
return send(res,404,{error:'Not found'})
}catch(e){send(res,400,{error:e.message})}
}).listen(Number(process.env.PORT||10000),'0.0.0.0');