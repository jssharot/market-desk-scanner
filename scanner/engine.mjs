export const RULES = Object.freeze({version:'paper-v1',symbols:['SPY','QQQ','AAPL','MSFT','NVDA','META','TSLA'],pollSeconds:15,openingMinutes:15,volumeMultiple:1.5,minDTE:7,maxDTE:21,minDelta:0.4,maxDelta:0.65,maxSpread:0.05,maxQuoteAgeSeconds:30,maxPremium:3,maxOpen:3,maxDailyLoss:500,feePerContract:0.65,slippage:0.01});
const easternFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}),easternCache=new Map();
export function eastern(t){const minute=Math.floor(new Date(t).getTime()/60000),known=easternCache.get(minute);if(known)return known;const p=easternFormat.formatToParts(new Date(minute*60000)),v=k=>p.find(x=>x.type===k).value,result=Object.freeze({date:v('year')+'-'+v('month')+'-'+v('day'),minute:+v('hour')*60 + +v('minute')});easternCache.set(minute,result);if(easternCache.size>10000)easternCache.delete(easternCache.keys().next().value);return result;}

const avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
const ema=(a,n)=>a.reduce((s,x,i)=>i?s+(x-s)*2/(n+1):x,0);
export function evaluateSignal(symbol,input,now=Date.now()){
 const blocked=(reason,detail,context={})=>({signal:null,reason,detail,...context});
 const date=eastern(now).date,bars=input.filter(b=>eastern(b.t).date===date&&eastern(b.t).minute>=570&&eastern(b.t).minute<960&&Date.parse(b.t)+60000<=now).sort((a,b)=>Date.parse(a.t)-Date.parse(b.t));
 if(bars.length<25)return blocked('warmup','Need 25 completed regular-session bars',{bars:bars.length});
 if(new Set(bars.map(b=>b.t)).size!==bars.length||bars.some(b=>![b.o,b.h,b.l,b.c,b.v,b.vw].every(Number.isFinite)||b.v<=0||b.l>b.h||b.c<b.l||b.c>b.h))return blocked('invalid-bars','Missing, duplicate or invalid candle fields');
 const last=bars.at(-1),prev=bars.at(-2),minute=eastern(last.t).minute;
 if(now-Date.parse(last.t)>90000)return blocked('stale-bars','Latest completed candle is too old',{barTime:last.t});
 if(minute<585||minute>=930)return blocked('entry-window','Outside strategy entry window',{barTime:last.t});
 if(bars.slice(-22).some((b,i,a)=>i&&Date.parse(b.t)-Date.parse(a[i-1].t)!==60000))return blocked('bar-gaps','A recent one-minute candle is missing',{barTime:last.t});
 const opening=bars.filter(b=>eastern(b.t).minute<585);
 if(opening.length!==15||eastern(opening[0].t).minute!==570)return blocked('opening-range-missing','Missing first 15 regular-session candles',{barTime:last.t});
 const high=Math.max(...opening.map(b=>b.h)),low=Math.min(...opening.map(b=>b.l)),closes=bars.map(b=>b.c),vol=last.v/avg(bars.slice(-21,-1).map(b=>b.v));
 let sum=0,volume=0;const vwaps=bars.map(b=>{sum+=b.vw*b.v;volume+=b.v;return sum/volume}),vwap=vwaps.at(-1),fast=ema(closes,9),slow=ema(closes,21);
 if(vol<RULES.volumeMultiple)return blocked('volume','Trigger volume below 1.5× prior 20 bars',{barTime:last.t,volumeRatio:vol});
 const up=last.c>vwap&&fast>slow&&vwap>vwaps.at(-4),down=last.c<vwap&&fast<slow&&vwap<vwaps.at(-4);
 let side,setup,stop;
 if(up&&prev.c<=high&&last.c>high){side='call';setup='Opening range breakout';stop=Math.min(prev.l,high)}
 else if(down&&prev.c>=low&&last.c<low){side='put';setup='Opening range breakdown';stop=Math.max(prev.h,low)}
 else if(up&&prev.l<=Math.max(vwaps.at(-2),ema(closes.slice(0,-1),9))&&prev.c>vwaps.at(-2)&&last.c>prev.h){side='call';setup='Trend pullback';stop=Math.min(prev.l,last.l)}
 else if(down&&prev.h>=Math.min(vwaps.at(-2),ema(closes.slice(0,-1),9))&&prev.c<vwaps.at(-2)&&last.c<prev.l){side='put';setup='Trend pullback';stop=Math.max(prev.h,last.h)}
 else return blocked('trigger','No confirmed range breakout or trend pullback',{barTime:last.t,volumeRatio:vol,vwap,ema9:fast,ema21:slow});
 const risk=Math.abs(last.c-stop);if(risk/last.c<0.001||risk/last.c>0.01)return blocked('stop-distance','Underlying stop distance outside 0.1–1% rule',{barTime:last.t,volumeRatio:vol,stopDistancePercent:risk/last.c*100});
 const signal={id:[RULES.version,date,symbol,side,setup.replaceAll(' ','-'),last.t].join(':'),version:RULES.version,symbol,side,setup,barTime:last.t,underlying:last.c,stop,target:last.c+(side==='call'?1:-1)*risk*2,risk,vwap,ema9:fast,ema21:slow,volumeRatio:vol,openingHigh:high,openingLow:low,validUntil:new Date(Date.parse(last.t)+120000).toISOString()};
 return {signal,reason:'underlying-qualified',detail:'Confirmed underlying trigger; checking contract',barTime:last.t,volumeRatio:vol};
}
export function signalFor(symbol,input,now=Date.now()){return evaluateSignal(symbol,input,now).signal;}

export function freshQuote(q,now=Date.now()){return q&&[q.bp,q.ap,q.bs,q.as].every(Number.isFinite)&&q.bp>0&&q.ap>=q.bp&&q.bs>=1&&q.as>=1&&Number.isFinite(Date.parse(q.t))&&now-Date.parse(q.t)>=-5000&&now-Date.parse(q.t)<=RULES.maxQuoteAgeSeconds*1000;}
export function inspectContracts(chain,signal,now=Date.now(),maxPremium=RULES.maxPremium){
 const today=eastern(now).date,out=[],rejected={};let cheapestEligibleAsk=null;const reject=reason=>{rejected[reason]=(rejected[reason]||0)+1;};
 for(const [symbol,s]of Object.entries(chain)){
 const m=symbol.match(/^(\w+)(\d{6})([CP])(\d{8})$/);if(!m||m[1]!==signal.symbol||m[3]!== (signal.side==='call'?'C':'P')){reject('contract-symbol');continue;}
 const expiry='20'+m[2].slice(0,2)+'-'+m[2].slice(2,4)+'-'+m[2].slice(4,6),dte=(Date.parse(expiry+'T12:00Z')-Date.parse(today+'T12:00Z'))/86400000,q=s.latestQuote,g=s.greeks,iv=s.impliedVolatility;
 if(dte<RULES.minDTE||dte>RULES.maxDTE){reject('expiration');continue;}
 if(!freshQuote(q,now)){reject('quote-stale-or-invalid');continue;}
 if(!g||!['delta','gamma','theta','vega'].every(k=>Number.isFinite(g[k]))||!Number.isFinite(iv)||iv<=0){reject('greeks-or-iv-missing');continue;}
 if(Math.abs(g.delta)<RULES.minDelta||Math.abs(g.delta)>RULES.maxDelta||signal.side==='call'&&g.delta<=0||signal.side==='put'&&g.delta>=0){reject('delta');continue;}
 const spread=(q.ap-q.bp)/((q.ap+q.bp)/2);if(spread>RULES.maxSpread){reject('spread');continue;}
 cheapestEligibleAsk=cheapestEligibleAsk===null?q.ap:Math.min(cheapestEligibleAsk,q.ap);
 if(q.ap+RULES.slippage>maxPremium){reject('paper-budget');continue;}
 out.push({symbol,expiry,strike:+m[4]/1000,bid:q.bp,ask:q.ap,quoteTime:q.t,spread,greeks:g,iv,dte,bidSize:q.bs,askSize:q.as});
 }
 const selected=out.sort((a,b)=>Math.abs(Math.abs(a.greeks.delta)-0.5)-Math.abs(Math.abs(b.greeks.delta)-0.5)||a.spread-b.spread)[0]||null;return {selected,total:Object.keys(chain).length,eligible:out.length,rejected,cheapestEligibleAsk,maxPremium};
}
export function selectContract(chain,signal,now=Date.now(),maxPremium=RULES.maxPremium){return inspectContracts(chain,signal,now,maxPremium).selected;}

export function openPaper(signal,contract,now=Date.now()){return {...signal,contract,status:'open',openedAt:new Date(now).toISOString(),entryPremium:contract.ask+RULES.slippage,contracts:1,entryFee:RULES.feePerContract,entryQuoteTime:contract.quoteTime,fillModel:'Buy ask + $0.01; sell bid - $0.01; $0.65 fee each way',maxEntry:contract.ask+RULES.slippage,markPremium:contract.bid};}
export function closeReason(p,underlying,q,minutesToClose){if(minutesToClose<=5)return 'End of session';if((p.side==='call'&&underlying<=p.stop)||(p.side==='put'&&underlying>=p.stop))return 'Underlying invalidation';if((p.side==='call'&&underlying>=p.target)||(p.side==='put'&&underlying<=p.target))return 'Underlying 2R target';if(q?.bp<=p.entryPremium*0.75)return 'Premium loss threshold';return null;}
export function closePaper(p,q,reason,now=Date.now()){if(!freshQuote(q,now))return {...p,pendingExit:reason};const exitPremium=Math.max(0,q.bp-RULES.slippage),pnl=(exitPremium-p.entryPremium)*100-p.entryFee-RULES.feePerContract;return {...p,status:'closed',closedAt:new Date(now).toISOString(),exitPremium,exitQuoteTime:q.t,exitReason:reason,pendingExit:null,pnl,exitFee:RULES.feePerContract};}
export function metrics(journal){const closed=journal.filter(p=>p.status==='closed'),pnls=closed.map(p=>p.pnl),wins=pnls.filter(p=>p>0),losses=pnls.filter(p=>p<0);let equity=0,peak=0,drawdown=0;for(const p of [...closed].sort((a,b)=>a.closedAt.localeCompare(b.closedAt))){equity+=p.pnl;peak=Math.max(peak,equity);drawdown=Math.max(drawdown,peak-equity)}return {closed:closed.length,open:journal.length-closed.length,pnl:pnls.reduce((s,x)=>s+x,0),winRate:closed.length?wins.length/closed.length:null,averageWin:wins.length?avg(wins):null,averageLoss:losses.length?avg(losses):null,expectancy:closed.length?avg(pnls):null,maxDrawdown:drawdown};}
