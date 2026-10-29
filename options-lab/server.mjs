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
 const raw=(u.searchParams.get('symbols')||'SPY,QQQ,AAPL,MSFT,NVDA,META,TSLA').split(',').map(x=>x.trim().toUpperCase());
 const symbols=[...new Set(raw)].slice(0,10).map(symbol);
 const target=new URL('/quotes',base);target.searchParams.set('symbols',symbols.join(','));
 const j=await upstream(target.pathname+target.search);
 return send(res,200,{quotes:j.quotes||[],checkedAt:j.checkedAt||null,source:j.source||'Alpaca SIP',note:'Watchlist quote scanner only. These are not validated options trade signals.'});
}
if(req.method==='POST'&&u.pathname==='/api/ask'){
 const aiKey=process.env.OPENAI_API_KEY;
 if(!aiKey)return send(res,503,{error:'AI assistant needs OPENAI_API_KEY configured on Options Lab in Render.'});
 let body='';for await(const chunk of req){body+=chunk;if(body.length>5000)return send(res,413,{error:'Question too long'})}
 let question;try{question=JSON.parse(body).question}catch{return send(res,400,{error:'Invalid request'})}
 if(typeof question!=='string'||!question.trim()||question.length>1000)return send(res,400,{error:'Question must be 1–1000 characters'});
 const tickers=[...new Set((question.toUpperCase().match(/\\b[A-Z]{2,5}\\b/g)||[]).filter(x=>!['WHAT','ABOUT','CALL','PUT','THIS','WITH','THE','FOR','GOOD','SHORT','TERM','PLAY','WHATS','TRADE','OPTION','PRICE','DATA'].includes(x)))].slice(0,2);
 const marketContext={checkedAt:new Date().toISOString(),stocks:[],options:[],errors:[]};
 for(const ticker of tickers){
  try{
   const q=new URL('/quotes',base);q.searchParams.set('symbols',ticker);
   const snapshot=await upstream(q.pathname+q.search);
   marketContext.stocks.push({symbol:ticker,quote:(snapshot.quotes||[])[0]||null,checkedAt:snapshot.checkedAt,source:snapshot.source});
  }catch{marketContext.errors.push(ticker+': stock quote unavailable')}
  if(!/\\b(option|options|call|calls|put|puts|contract|strike|expiry|expiration|play)\\b/i.test(question))continue;
  try{
   const e=new URL('/expirations',base);e.searchParams.set('symbol',ticker);
   const exp=await upstream(e.pathname+e.search);
   const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'});
   const soon=(exp.expirations||[]).filter(d=>{const days=(Date.parse(d+'T12:00:00Z')-Date.parse(today+'T12:00:00Z'))/86400000;return days>=0&&days<=10}).slice(0,2);
   for(const date of soon){
    for(const side of ['call','put']){
     try{
      const q=new URL('/chain',base);for(const [k,v] of Object.entries({symbol:ticker,expiry:date,side}))q.searchParams.set(k,v);
      const chain=await upstream(q.pathname+q.search);
      const screened=(chain.contracts||[]).map(c=>({symbol:c.symbol,strike:c.strike,side,expiry:date,bid:c.bid,ask:c.ask,iv:c.iv,delta:c.greeks?.delta??null,quoteTime:c.quoteTime,screen:screenContract({...c,expiry:date})}));
      const eligible=screened.filter(c=>c.screen.eligible).sort((a,b)=>(a.screen.spreadPct??99)-(b.screen.spreadPct??99)).slice(0,3);
      const spot=marketContext.stocks.find(x=>x.symbol===ticker)?.quote?.price;
      const candidates=screened.filter(c=>Number.isFinite(c.ask)&&c.ask>0&&c.ask*100<=1000)
        .sort((a,b)=>Number.isFinite(spot)?Math.abs(a.strike-spot)-Math.abs(b.strike-spot):a.strike-b.strike).slice(0,5);
      marketContext.options.push({symbol:ticker,expiry:date,side,checkedAt:chain.checkedAt,source:chain.source,totalContracts:screened.length,eligible,candidates,eligibleCount:screened.filter(c=>c.screen.eligible).length,warning:'Candidates may be stale or ineligible; screen.reasons must be respected.'});
     }catch{marketContext.errors.push(ticker+' '+date+' '+side+': chain unavailable')}
    }
   }
  }catch{marketContext.errors.push(ticker+': expirations unavailable')}
 }
 const ai=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+aiKey,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',instructions:'You are the Options Lab research assistant. Use only the supplied timestamped Alpaca stock and OPRA option data for price claims. Explain whether quotes are stale and do not recommend trades based on stale quotes. If no eligible contracts, explain why using candidate screen.reasons; distinguish historical last quotes from actionable current quotes. Never tell the user to provide option chain data when it was retrieved, and never claim no chain data if a chain was retrieved. Never invent live quotes, option chain data, trading signals, account balances, fills, or positions. If data is missing say so. Do not claim to execute trades. Keep responses concise and practical, distinguish research from advice.',input:'Question: '+question+'\\nMarket context: '+JSON.stringify(marketContext),max_output_tokens:650}),signal:AbortSignal.timeout(25000)});
 if(!ai.ok)return send(res,502,{error:'AI provider returned '+ai.status});
 const j=await ai.json();
 const answer=j.output_text||j.output?.flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\\n')||'No answer available';
 return send(res,200,{answer,marketCheckedAt:marketContext.checkedAt||null,marketSources:marketContext.stocks.map(x=>x.source).concat(marketContext.options.map(x=>x.source)),dataWarnings:marketContext.errors});
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