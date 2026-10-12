import {createServer} from 'node:http';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {timingSafeEqual,webcrypto} from 'node:crypto';
import {RULES,eastern,signalFor,selectContract,freshQuote,openPaper,closeReason,closePaper,metrics} from './engine.mjs';
import {pushNotify,validPushSubscription,pushId} from './push.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const env=process.env,dir=env.SCANNER_DATA_DIR||'/var/data/scanner',file=dir+'/state.json';
if(!env.SCANNER_SHARED_SECRET||env.SCANNER_SHARED_SECRET.length<32)throw Error('SCANNER_SHARED_SECRET must contain at least 32 characters');
await mkdir(dir,{recursive:true});
let store;try{store=JSON.parse(await readFile(file,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;store={paused:true,journal:[],events:[],subscriptions:{},delivered:{},lastCheck:null,status:'Waiting for data credentials',missedChecks:0};}
let saveQueue=Promise.resolve();function save(){const data=JSON.stringify(store);saveQueue=saveQueue.then(async()=>{await writeFile(file+'.tmp',data,{mode:0o600});await rename(file+'.tmp',file)});return saveQueue;}
const bucket={async list({prefix}){return {objects:Object.keys(store.subscriptions).filter(k=>('push-subscriptions/'+k+'.json').startsWith(prefix)).map(k=>({key:'push-subscriptions/'+k+'.json'})),truncated:false}},async get(key){const v=key.startsWith('push-delivered/')?store.delivered[key]:store.subscriptions[key.split('/')[1]?.replace(/\.json$/,'')];return v?{json:async()=>v}:null},async put(key,data){if(key.startsWith('push-delivered/'))store.delivered[key]=JSON.parse(data);else store.subscriptions[key.split('/')[1].replace(/\.json$/,'')]=JSON.parse(data);await save()},async delete(key){delete store.subscriptions[key.split('/')[1].replace(/\.json$/,'')];await save()}};
const pushEnv={BUCKET:bucket,VAPID_PUBLIC_KEY:env.VAPID_PUBLIC_KEY,VAPID_PRIVATE_JWK:env.VAPID_PRIVATE_JWK};
async function api(base,path,params={}){const u=new URL(path,base);Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));const r=await fetch(u,{headers:{'APCA-API-KEY-ID':env.ALPACA_API_KEY,'APCA-API-SECRET-KEY':env.ALPACA_SECRET_KEY},signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Market-data request failed ('+r.status+')');return r.json()}
const data=(path,params)=>api('https://data.alpaca.markets',path,params);
let sessionCache;async function session(now){const date=eastern(now).date;if(sessionCache?.date===date)return sessionCache;const rows=await api('https://paper-api.alpaca.markets','/v2/calendar',{start:date,end:date}),row=rows[0],minutes=s=>+s.slice(0,2)*60 + +s.slice(3,5);sessionCache={date,open:row?minutes(row.open):null,close:row?minutes(row.close):null};return sessionCache;}
async function barsFor(now){const all={},end=new Date(Math.floor(now/60000)*60000-1).toISOString();let token;do{const r=await data('/v2/stocks/bars',{symbols:RULES.symbols.join(','),timeframe:'1Min',start:eastern(now).date+'T00:00:00Z',end,feed:'sip',limit:'10000',...(token?{page_token:token}:{})});for(const [s,b]of Object.entries(r.bars||{}))all[s]=[...(all[s]||[]),...b];token=r.next_page_token;}while(token);return all;}
async function chainFor(s,now){const today=eastern(now).date,plus=n=>new Date(Date.parse(today+'T12:00Z')+n*86400000).toISOString().slice(0,10),out={};let token;do{const r=await data('/v1beta1/options/snapshots/'+s.symbol,{feed:'opra',type:s.side,expiration_date_gte:plus(RULES.minDTE),expiration_date_lte:plus(RULES.maxDTE),strike_price_gte:s.underlying*0.95,strike_price_lte:s.underlying*1.05,limit:'1000',...(token?{page_token:token}:{})});Object.assign(out,r.snapshots);token=r.next_page_token;}while(token);return out;}
async function event(p,action){const e={id:p.id+':'+action,tradeId:p.id,action,symbol:p.symbol,time:new Date().toISOString(),setup:p.setup,contract:p.contract.symbol,detail:action==='PAPER ENTRY'?'Simulated entry at ask + $0.01.':p.exitReason||p.pendingExit||'',pnl:p.pnl??null};if(store.events.some(x=>x.id===e.id))return;store.events.unshift(e);store.events=store.events.slice(0,2000);await save();}
async function notifications(){for(const e of store.events.slice(0,50)){if(Date.now()-Date.parse(e.time)>300000)continue;await pushNotify(pushEnv,'trades',e.id,{title:e.action+' · '+e.symbol,body:e.contract+' · '+e.detail,url:'/scanner',tag:e.id})}}
let stopped=false,inFlight=false;
async function tick(){if(inFlight||stopped)return;inFlight=true;try{
 const now=Date.now();if(!env.ALPACA_API_KEY||!env.ALPACA_SECRET_KEY){store.status='Waiting for Alpaca credentials';return}
 const hours=await session(now),minute=eastern(now).minute;store.lastCheck=new Date().toISOString();store.session=hours;
 if(hours.open===null){store.status='Market holiday / weekend';return}
 if(minute<hours.open||minute>=hours.close){store.status='Market closed';return}
 // A restart never invents exits for missed periods. Any unclosed prior-day trades await a fresh quote.
 const open=store.journal.filter(p=>p.status==='open'),symbols=[...new Set([...RULES.symbols,...open.map(p=>p.symbol)])],sq=await data('/v2/stocks/quotes/latest',{symbols:symbols.join(','),feed:'sip'}),options=open.length?await data('/v1beta1/options/quotes/latest',{symbols:open.map(p=>p.contract.symbol).join(','),feed:'opra'}):{quotes:{}};
 for(const p of open){const q=options.quotes?.[p.contract.symbol],u=sq.quotes?.[p.symbol],oldDay=eastern(p.openedAt).date!==hours.date;
 const reason=p.pendingExit||(oldDay?'Recovered after monitoring gap':hours.close-minute<=5?'End of session':freshQuote(u)?closeReason(p,(u.bp+u.ap)/2,freshQuote(q)?q:null,hours.close-minute):null);
 if(reason){const next=closePaper(p,q,reason,now);Object.assign(p,next);if(p.status==='closed')await event(p,'PAPER EXIT')}
 else if(freshQuote(q)){p.markPremium=q.bp;p.markTime=q.t;p.unrealizedPnl=(q.bp-RULES.slippage-p.entryPremium)*100-p.entryFee-RULES.feePerContract}
 }
 const closedToday=store.journal.filter(p=>p.status==='closed'&&eastern(p.closedAt).date===hours.date),dailyPnl=closedToday.reduce((s,p)=>s+p.pnl,0);
 if(store.paused){store.status='Paper entries paused; open simulations still monitored';return}
 if(dailyPnl<=-RULES.maxDailyLoss){store.status='Daily paper loss limit reached';return}
 if(minute>=Math.min(930,hours.close-30)){store.status='Exit monitoring only';return}
 const bars=await barsFor(now);store.status='Scanning SIP stocks / OPRA options';
 for(const symbol of RULES.symbols){if(store.journal.filter(p=>p.status==='open').length>=RULES.maxOpen)break;if(store.journal.some(p=>p.symbol===symbol&&p.status==='open'))continue;
 const signal=signalFor(symbol,bars[symbol]||[],now);if(!signal||store.journal.some(p=>p.id===signal.id))continue;
 // One attempt per symbol/setup/direction each session prevents repeated whipsaw entries.
 if(store.journal.some(p=>p.version===signal.version&&eastern(p.openedAt).date===hours.date&&p.symbol===symbol&&p.side===signal.side&&p.setup===signal.setup))continue;
 const current=sq.quotes?.[symbol];if(!freshQuote(current,now))continue;
 const price=(current.bp+current.ap)/2;if(Math.abs(price-signal.underlying)>signal.risk*0.25)continue;
 const contract=selectContract(await chainFor(signal,now),signal,Date.now());if(!contract)continue;
 // Recheck stock after chain request; do not simulate an entry after trigger expiry or invalidation.
 const latest=(await data('/v2/stocks/quotes/latest',{symbols:symbol,feed:'sip'})).quotes?.[symbol],checked=Date.now();if(!freshQuote(latest,checked)||checked>Date.parse(signal.validUntil))continue;
 const spot=(latest.bp+latest.ap)/2;if(Math.abs(spot-signal.underlying)>signal.risk*0.25||signal.side==='call'&&spot<=signal.stop||signal.side==='put'&&spot>=signal.stop)continue;
 if(!freshQuote({bp:contract.bid,ap:contract.ask,bs:contract.bidSize,as:contract.askSize,t:contract.quoteTime},checked))continue;
 const p=openPaper(signal,contract,checked);store.journal.push(p);await event(p,'PAPER ENTRY');
 }
 }catch{store.status='Data connection error — entries withheld';store.missedChecks++;}finally{await save();try{await notifications()}catch{}inFlight=false;}}
const authorized=req=>{const value=req.headers.authorization||'',expected='Bearer '+env.SCANNER_SHARED_SECRET;return value.length===expected.length&&timingSafeEqual(Buffer.from(value),Buffer.from(expected))};
async function body(req){let text='';for await(const part of req){text+=part;if(text.length>20000)throw Error('Request too large')}return JSON.parse(text)}
const server=createServer(async(req,res)=>{res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');const send=(status,v)=>{res.writeHead(status);res.end(JSON.stringify(v))};try{if(req.url==='/health')return send(200,{ok:true});if(!authorized(req))return send(401,{error:'Unauthorized'});
 if(req.method==='GET'&&req.url==='/state')return send(200,{connected:store.feedVerified===true,credentialsConfigured:Boolean(env.ALPACA_API_KEY&&env.ALPACA_SECRET_KEY),publicKey:env.VAPID_PUBLIC_KEY||'',notificationsAvailable:Boolean(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_JWK),mode:'paper',paused:store.paused,status:store.status,lastCheck:store.lastCheck,rules:RULES,journal:store.journal,events:store.events.slice(0,100),metrics:metrics(store.journal),missedChecks:store.missedChecks,session:store.session});
 if(req.method==='POST'&&req.url==='/diagnostics'){try{const q=await data('/v2/stocks/quotes/latest',{symbols:'SPY',feed:'sip'}),chain=await data('/v1beta1/options/snapshots/SPY',{feed:'opra',limit:'1'});if(!q.quotes?.SPY||!Object.keys(chain.snapshots||{}).length)throw Error('Provider returned no data');await session(Date.now());store.feedVerified=true;store.diagnostics={checkedAt:new Date().toISOString(),stockFeed:'sip',optionFeed:'opra',stockQuoteTime:q.quotes.SPY.t,optionContractsReturned:Object.keys(chain.snapshots).length,calendar:true};await save();return send(200,{verified:true,...store.diagnostics})}catch(e){store.feedVerified=false;await save();return send(503,{verified:false,error:e.message})}}
 if(req.method==='POST'&&req.url==='/test'){const result=await pushNotify(pushEnv,'trades','scanner-test:'+Date.now(),{title:'Paper scanner notifications connected',body:'This is a notification test. No trade was entered.',url:'/scanner'});return send(200,result)}
 if(req.method==='POST'&&req.url==='/control'){const v=await body(req);if(typeof v.paused!=='boolean')throw Error('Supply paused');store.paused=v.paused;await save();return send(200,{saved:true,paused:store.paused})}
 if(req.method==='POST'&&req.url==='/subscriptions'){const v=await body(req),s=validPushSubscription(v.subscription),id=await pushId(s);if(v.remove)delete store.subscriptions[id];else store.subscriptions[id]={id,subscription:s,preferences:{trades:v.enabled===true}};await save();return send(200,{saved:true})}
 send(404,{error:'Not found'});
 }catch{send(400,{error:'Invalid request'})}});
server.listen(Number(env.PORT||10000),'0.0.0.0',()=>console.log('Paper scanner service listening'));
const timer=setInterval(tick,RULES.pollSeconds*1000);tick();
async function shutdown(){stopped=true;clearInterval(timer);server.close();while(inFlight)await new Promise(r=>setTimeout(r,100));await save();process.exit(0)}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
