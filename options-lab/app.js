const $=id=>document.getElementById(id);
const savedKey=localStorage.getItem('olab-key')||sessionStorage.getItem('olab-key')||'';
if(savedKey){$('key').value=savedKey;$('key-status').textContent='Access key remembered on this device.';$('access-summary').textContent='Saved'}else{$('access-panel').open=true;$('access-summary').textContent='Setup required'}
$('save-key').onclick=()=>{const key=$('key').value.trim();if(!key){$('key-status').textContent='Enter an access key first.';return}localStorage.setItem('olab-key',key);sessionStorage.removeItem('olab-key');$('key-status').textContent='Saved. You will stay signed in on this browser.';$('access-summary').textContent='Saved';$('access-panel').open=false};
$('forget-key').onclick=()=>{localStorage.removeItem('olab-key');sessionStorage.removeItem('olab-key');$('key').value='';$('key-status').textContent='Saved key removed from this browser.';$('access-summary').textContent='Setup required';$('access-panel').open=true};
async function api(path,options={}){const key=localStorage.getItem('olab-key')||sessionStorage.getItem('olab-key')||'';const r=await fetch(path,{...options,headers:{'x-options-lab-key':key,...(options.headers||{})}});const j=await r.json();if(!r.ok)throw Error(j.error||'Request failed');return j}
const displayDate=iso=>{const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso||''));return match?match[2]+'/'+match[3]+'/'+match[1]:(iso||'—')};
const etParts=()=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));return {date:v.year+'-'+v.month+'-'+v.day,minute:Number(v.hour)*60+Number(v.minute)}};
const timeET=minute=>{const h=Math.floor(minute/60),m=minute%60;return (h%12||12)+':'+String(m).padStart(2,'0')+(h<12?' AM':' PM')+' ET'};
function nextWeekday(iso){const d=new Date(iso+'T12:00:00Z');do{d.setUTCDate(d.getUTCDate()+1)}while([0,6].includes(d.getUTCDay()));return d.toISOString().slice(0,10)}
async function refreshMarketStatus(){
 const label=$('market-label'),el=$('market-status');
 try{
  const j=await api('/api/market-status'),now=etParts(),sess=j.session||{};
  if(sess.date!==now.date)throw Error('Calendar update pending');
  const isSession=Number.isFinite(sess.open)&&Number.isFinite(sess.close);
  const open=isSession&&now.minute>=sess.open&&now.minute<sess.close;
  el.className='market-status '+(open?'open':'closed');
  if(open)label.textContent='Market open · Closes '+timeET(sess.close);
  else if(isSession&&now.minute<sess.open)label.textContent='Market closed · Opens today '+timeET(sess.open);
  else label.textContent='Market closed · Expected next open '+displayDate(nextWeekday(now.date))+' 9:30 AM ET';
 }catch(e){el.className='market-status unknown';label.textContent='Market status unavailable'}
}
refreshMarketStatus();
setInterval(refreshMarketStatus,60000);
let selectedSymbol='SPY',searchTimer=null,searchSequence=0,quoteSequence=0,loadSequence=0;
const input=$('symbol'),suggestions=$('ticker-suggestions');
const quoteDate=t=>{const ms=Date.parse(t||'');return Number.isFinite(ms)?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'2-digit',day:'2-digit',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(ms):'Unavailable'};
function hideSuggestions(){suggestions.hidden=true;suggestions.replaceChildren()}
async function showQuote(symbol){
 const requestId=++quoteSequence;
 $('stock-quote').hidden=true;
 try{
  const j=await api('/api/stock-quote?symbol='+encodeURIComponent(symbol)),q=j.quote;
  if(requestId!==quoteSequence||input.value.trim().toUpperCase()!==symbol)return;
  if(!q||q.unavailable||!Number.isFinite(q.price))return;
  $('stock-price').textContent=symbol+' '+money(q.price);
  const pct=Number(q.changePercent),change=Number(q.change);
  $('stock-change').textContent=Number.isFinite(pct)?(pct>=0?'+':'')+pct.toFixed(2)+'%'+(Number.isFinite(change)?' ('+(change>=0?'+':'')+money(change)+')':''):'Change unavailable';
  $('stock-change').className=Number.isFinite(pct)?(pct>=0?'positive':'negative'):'';
  $('stock-asof').textContent='As of '+quoteDate(q.asOf)+' · '+(q.stale?'Stale last trade · ':'')+(j.source||'Alpaca SIP');
  $('stock-quote').hidden=false;
 }catch(e){if(requestId===quoteSequence)$('stock-quote').hidden=true}
}
input.addEventListener('input',()=>{
 const q=input.value.trim();selectedSymbol='';++quoteSequence;++loadSequence;$('stock-quote').hidden=true;clearTimeout(searchTimer);const id=++searchSequence;hideSuggestions();
 if(!q)return;
 searchTimer=setTimeout(async()=>{
  try{
   const j=await api('/api/ticker-search?q='+encodeURIComponent(q));
   if(id!==searchSequence||input.value.trim()!==q)return;
   const items=j.results||[];
   suggestions.replaceChildren(...items.map(item=>{
    const b=document.createElement('button');b.type='button';b.setAttribute('role','option');
    const name=document.createElement('small');name.textContent=item.name||'';
    b.textContent=item.symbol;b.append(name);
    b.onclick=()=>{++quoteSequence;++loadSequence;selectedSymbol=item.symbol;input.value=item.symbol;hideSuggestions();$('expiry').replaceChildren();$('quotes').replaceChildren();$('stock-quote').hidden=true;showQuote(item.symbol)};
    return b;
   }));suggestions.hidden=!items.length;
  }catch(e){hideSuggestions()}
 },250);
});
input.addEventListener('keydown',e=>{if(e.key==='Escape')hideSuggestions();if(e.key==='Enter'&&!suggestions.hidden){const first=suggestions.querySelector('button');if(first){e.preventDefault();first.click()}}});
document.addEventListener('click',e=>{if(!e.target.closest('.ticker-field'))hideSuggestions()});
$('clear-research').onclick=()=>{clearTimeout(searchTimer);++searchSequence;++quoteSequence;++loadSequence;selectedSymbol='';input.value='';$('expiry').replaceChildren();$('quotes').replaceChildren();lastContracts=[];hideSuggestions();$('stock-quote').hidden=true;$('stock-price').textContent='';$('stock-change').textContent='';$('stock-asof').textContent='';$('status').textContent='';$('chain-count').textContent='';input.focus()};
$('load').onclick=async()=>{try{const symbol=(selectedSymbol||$('symbol').value.trim().toUpperCase());if(!/^[A-Z]{1,5}$/.test(symbol))throw Error('Select a ticker from suggestions');input.value=symbol;hideSuggestions();showQuote(symbol);const requestId=++loadSequence;$('status').textContent='Loading…';const j=await api('/api/expirations?symbol='+encodeURIComponent(symbol));if(requestId!==loadSequence)return;const today=Date.parse(new Date().toISOString().slice(0,10)+'T12:00:00Z');const ex=(j.expirations||[]).filter(x=>{const d=(Date.parse(x+'T12:00:00Z')-today)/86400000;return d>=0&&d<=10});$('expiry').replaceChildren(...ex.map(e=>new Option(displayDate(e),e)));$('status').textContent=ex.length+' short-term expirations';}catch(e){$('status').textContent=e.message}};
let lastContracts=[];
const money=n=>Number.isFinite(n)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n):'—';
const quoteTime=t=>{const ms=Date.parse(t||'');return Number.isFinite(ms)?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'2-digit',day:'2-digit',year:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(ms):'Unavailable'};
function renderChain(){
 const filter=$('contract-filter').value;
 const ordered=[...lastContracts].sort((a,b)=>Number(b.screen.eligible)-Number(a.screen.eligible)||a.strike-b.strike);
 const shown=ordered.filter(c=>filter==='all'||filter==='eligible'||(filter==='filtered'&&!c.screen.eligible));
 const eligible=lastContracts.filter(c=>c.screen.eligible).length;
 $('chain-count').textContent=eligible+' eligible / '+lastContracts.length+' total'+(filter==='eligible'?' • Eligible shown first':'');
 $('quotes').replaceChildren(...shown.map(c=>{
  const tr=document.createElement('tr');tr.className=c.screen.eligible?'row-eligible':'row-filtered';
  const values=[c.strike,c.bid,c.ask,money(c.screen.premiumDollars),quoteTime(c.quoteTime),c.screen.eligible?'Eligible':c.screen.reasons.join(', ')];
  for(const v of values){const td=document.createElement('td');td.textContent=String(v??'—');tr.append(td)}
  return tr;
 }));
}
$('contract-filter').onchange=renderChain;
$('chain').onclick=async()=>{try{
 const symbol=(selectedSymbol||$('symbol').value.trim().toUpperCase()),expiry=$('expiry').value,side=$('side').value;
 if(!expiry)throw Error('Select expiration');
 $('status').textContent='Loading contracts…';
 const j=await api('/api/chain?symbol='+encodeURIComponent(symbol)+'&expiry='+expiry+'&side='+side);
 lastContracts=j.screened||[];
 renderChain();
 $('status').textContent=lastContracts.length+' contracts • Retrieved '+quoteTime(j.checkedAt)+' • Screening is not a trade recommendation';
}catch(e){$('status').textContent=e.message}};

let watchlistRows=[],watchlistSort={key:'changePercent',direction:'desc'};
function renderWatchlist(){
 const key=watchlistSort.key,mult=watchlistSort.direction==='asc'?1:-1;
 const rows=[...watchlistRows].sort((a,b)=>{
  const x=a[key],y=b[key];
  if(key==='symbol')return mult*String(x||'').localeCompare(String(y||''));
  if(key==='asOf')return mult*((Date.parse(x)||0)-(Date.parse(y)||0));
  return mult*((Number(x)||0)-(Number(y)||0));
 });
 $('scanner-results').replaceChildren(...rows.map(q=>{
  const tr=document.createElement('tr');
  const ticker=document.createElement('td');
  const sym=document.createElement('span');sym.className='watch-symbol';sym.textContent=q.symbol||'—';
  const company=document.createElement('small');company.className='company-name';company.textContent=q.name&&q.name!==q.symbol?q.name:'';
  ticker.append(sym,company);tr.append(ticker);
  const pct=Number(q.changePercent);
  const values=[q.unavailable?'Unavailable':money(q.price),Number.isFinite(pct)?(pct>=0?'+':'')+pct.toFixed(2)+'%':'—',quoteDate(q.asOf)];
  for(const v of values){const td=document.createElement('td');td.textContent=String(v??'—');tr.append(td)}
  return tr;
 }));
 document.querySelectorAll('.sort-heading').forEach(b=>{
  const active=b.dataset.sort===key;
  b.querySelector('.sort-arrow').textContent=active?(watchlistSort.direction==='asc'?'▲':'▼'):'↕';
  b.setAttribute('aria-sort',active?(watchlistSort.direction==='asc'?'ascending':'descending'):'none');
 });
}
document.querySelectorAll('.sort-heading').forEach(b=>b.addEventListener('click',()=>{
 const key=b.dataset.sort;
 watchlistSort={key,direction:watchlistSort.key===key?(watchlistSort.direction==='asc'?'desc':'asc'):(key==='symbol'?'asc':'desc')};
 renderWatchlist();
}));
$('scan-watchlist').onclick=async()=>{
 $('scanner-status').textContent='Loading Alpaca watchlist…';$('scan-watchlist').disabled=true;
 try{
  const j=await api('/api/scanner');
  watchlistRows=j.quotes||[];
  renderWatchlist();
  $('scanner-status').textContent=watchlistRows.length+' tickers • Retrieved '+quoteDate(j.checkedAt)+' • Quotes may be stale outside market hours';
 }catch(e){$('scanner-status').textContent=e.message}
 finally{$('scan-watchlist').disabled=false}
};
const journalKey='olab-paper-journal-v1';
function journalRead(){try{return JSON.parse(localStorage.getItem(journalKey)||'[]')}catch{return []}}
function journalWrite(rows){localStorage.setItem(journalKey,JSON.stringify(rows));localStorage.setItem('olab-paper-last-change',new Date().toISOString());renderJournal();scheduleJournalSync()}
function journalStorageStatus(){const el=$('journal-storage-status');if(el)el.textContent='Local journal active • Database sync runs automatically after changes.'}
function renderPerformance(rows){
 const closed=rows.filter(x=>Number.isFinite(x.exit)&&Number.isFinite(x.entry)&&x.entry>0);
 const wins=closed.filter(x=>x.exit>x.entry);
 const open=rows.filter(x=>!Number.isFinite(x.exit));
 const pnl=x=>(x.exit-x.entry)*100;
 const net=closed.reduce((n,x)=>n+pnl(x),0);
 const grossWin=closed.reduce((n,x)=>n+Math.max(0,pnl(x)),0);
 const grossLoss=closed.reduce((n,x)=>n+Math.max(0,-pnl(x)),0);
 const pct=closed.length?(100*wins.length/closed.length).toFixed(1)+'%':'—';
 const factor=!closed.length||!grossLoss?'—':(grossWin/grossLoss).toFixed(2);
 const cells=[['Tracked',rows.length],['Open',open.length],['Closed',closed.length],['Win rate',pct],['Net simulated P/L',(net>=0?'+':'')+money(net)],['Avg closed trade',closed.length?money(net/closed.length):'—'],['Profit factor',factor]];
 const root=$('performance-kpis');if(root){root.replaceChildren(...cells.map(([label,value])=>{const div=document.createElement('div');div.className='performance-kpi';const l=document.createElement('small');l.textContent=label;const v=document.createElement('strong');v.textContent=value;div.append(l,v);return div}))}
 const groups=new Map();for(const x of closed){const tier=x.setupTier||'Unrated';if(!groups.has(tier))groups.set(tier,[]);groups.get(tier).push(x)}
 const body=$('performance-tiers');if(body)body.replaceChildren(...[...groups].map(([tier,items])=>{const tr=document.createElement('tr');const total=items.reduce((n,x)=>n+pnl(x),0);for(const v of [tier,String(items.length),(100*items.filter(x=>x.exit>x.entry).length/items.length).toFixed(1)+'%',(total>=0?'+':'')+money(total)]){const td=document.createElement('td');td.textContent=v;tr.append(td)}return tr}));
 const note=$('performance-note');if(note)note.textContent=closed.length?'Hypothetical one-contract returns based on recorded option premiums, before fees and slippage. '+(closed.length<30?'Early sample: fewer than 30 closed trades.':'Results are historical simulations, not a forecast.'):'No closed simulated trades yet. Metrics will populate from your synced journal.';
}
function renderJournal(){
 const rows=journalRead(),closed=rows.filter(x=>Number.isFinite(x.exit));
 renderPerformance(rows);
 const pnl=closed.reduce((n,x)=>n+(x.exit-x.entry)*100,0);const average=closed.length?pnl/closed.length:0;let equity=0,peak=0,drawdown=0;for(const x of [...closed].sort((a,b)=>Date.parse(a.closedAt||a.createdAt)-Date.parse(b.closedAt||b.createdAt))){equity+=(x.exit-x.entry)*100;peak=Math.max(peak,equity);drawdown=Math.max(drawdown,peak-equity)}
 const byTier=['High Conviction','Actionable','Watchlist','Developing','Unrated'].map(tier=>{const group=closed.filter(x=>(x.setupTier||'Unrated')===tier);return group.length?tier+': '+group.length+' closed, '+(100*group.filter(x=>x.exit>x.entry).length/group.length).toFixed(0)+'% wins, '+money(group.reduce((sum,x)=>sum+(x.exit-x.entry)*100,0))+' P/L':null}).filter(Boolean);
 $('journal-stats').textContent=rows.length+' tracked • '+closed.length+' closed • '+(closed.length?(100*closed.filter(x=>x.exit>x.entry).length/closed.length).toFixed(0)+'% win rate • ':'')+'Realized P/L '+(pnl>=0?'+':'')+money(pnl)+' • Avg/trade '+money(average)+' • Max drawdown '+money(drawdown)+(byTier.length?' | By entry tier: '+byTier.join(' • '):'');
 $('journal-rows').replaceChildren(...rows.map(x=>{
  const tr=document.createElement('tr');
  for(const value of [x.symbol+' '+x.expiry+' '+x.side+' '+x.strike,money(x.entry),Number.isFinite(x.exit)?money(x.exit):'Open',Number.isFinite(x.exit)?((x.exit/x.entry-1)*100).toFixed(1)+'%':'—']){
   const td=document.createElement('td');td.textContent=value;tr.append(td);
  }
  const td=document.createElement('td'),b=document.createElement('button');
  b.textContent=Number.isFinite(x.exit)?'Remove':'Close';
  b.onclick=()=>{
   const all=journalRead(),index=all.findIndex(y=>y.id===x.id);if(index<0)return;
   if(Number.isFinite(x.exit)){if(!confirm('Remove this paper trade?'))return;const deleted=JSON.parse(localStorage.getItem('olab-paper-deleted-v1')||'[]');localStorage.setItem('olab-paper-deleted-v1',JSON.stringify([...new Set([...deleted,String(x.id)])]));all.splice(index,1)}
   else{const value=prompt('Paper exit option premium per share (e.g. 2.50):');if(value===null)return;const exit=Number(value);if(!Number.isFinite(exit)||exit<0){alert('Enter a valid premium');return}all[index].exit=exit;all[index].closedAt=new Date().toISOString();all[index].exitReason='Manual'}
   journalWrite(all);
  };
  td.append(b);tr.append(td);return tr;
 }));
}
renderJournal();journalStorageStatus();
$('scan-options').onclick=async()=>{
 $('scan-options').disabled=true;$('opportunities-status').textContent='Checking active stocks and live option chains…';
 try{
  const data=await api('/api/opportunities');
  const results=$('opportunities-results');results.replaceChildren();
  let count=0;
  for(const item of data.candidates||[]){
   const section=document.createElement('div');section.style.marginBottom='16px';
   const heading=document.createElement('strong');heading.textContent=item.symbol+' • '+(Number(item.changePercent)>=0?'+':'')+Number(item.changePercent).toFixed(2)+'%';section.append(heading);
   if(!(item.contracts||[]).length){const p=document.createElement('p');p.className='muted';p.textContent=item.reason||'No contracts passed freshness, liquidity and budget checks';section.append(p)}
   for(const c of item.contracts||[]){
    count++;const line=document.createElement('div');line.style.margin='8px 0';line.style.display='flex';line.style.gap='12px';line.style.alignItems='center';line.style.flexWrap='wrap';
    const label=document.createElement('span');const setup=c.setup||{};label.textContent=c.side.toUpperCase()+' '+c.strike+' • '+displayDate(c.expiry||item.expiry)+' • Ask '+money(c.ask)+' • '+money(c.screen.premiumDollars)+'/contract • Setup '+(setup.score??'—')+'/100 '+(setup.tier||'Unrated')+' • Quote '+(c.screen.score??'—')+'/100'+(setup.confirmation==='momentum-only'?' • Momentum only':'');
    const btn=document.createElement('button');btn.textContent='Paper track';btn.onclick=()=>{
     const entry=Number(c.ask);if(!Number.isFinite(entry)||entry<=0)return;
     const rows=journalRead();rows.unshift({id:Date.now()+'-'+Math.random(),symbol:item.symbol,side:c.side,strike:c.strike,expiry:c.expiry||item.expiry,entry,setupScore:c.setup?.score??null,setupTier:c.setup?.tier||'Unrated',quoteScore:c.screen?.score??null,createdAt:new Date().toISOString()});journalWrite(rows);btn.disabled=true;btn.textContent='Tracked';
    };line.append(label,btn);section.append(line);
   }
   results.append(section);
  }
  $('opportunities-status').textContent=count+' eligible contracts across '+(data.candidates||[]).length+' movers • Checked '+quoteDate(data.checkedAt)+' • Not trade alerts';
 }catch(e){$('opportunities-status').textContent=e.message}
 finally{$('scan-options').disabled=false}
};

let notifiedWatchIds=new Set(),monitorInitialized=false;
const notifyPreferenceKey='olab-watch-notifications-enabled';
function updateNotifyButton(){
 const button=$('notify-watch'),footer=$('notify-footer');
 if(!('Notification' in window)){button.textContent='Notifications unsupported';button.disabled=true;footer.hidden=true;return}
 const allowed=Notification.permission==='granted';
 const wanted=localStorage.getItem(notifyPreferenceKey)==='true';
 button.hidden=allowed&&wanted;
 button.textContent=allowed?'Enable watch notifications':Notification.permission==='denied'?'Notifications blocked in browser':'Enable watch notifications';
 button.disabled=Notification.permission==='denied';
 footer.hidden=!allowed||!wanted;
 footer.textContent='🔕 Pause alerts';
 footer.title='Pause watch notifications on this device';
}
$('notify-watch').onclick=async()=>{
 if(!('Notification' in window))return;
 if(Notification.permission==='granted')localStorage.setItem(notifyPreferenceKey,'true');
 else if(await Notification.requestPermission()==='granted')localStorage.setItem(notifyPreferenceKey,'true');
 updateNotifyButton();
};
$('notify-footer').onclick=()=>{
 localStorage.setItem(notifyPreferenceKey,'false');
 updateNotifyButton();
};
updateNotifyButton();
async function refreshMonitor(){
 try{
  const state=await api('/api/monitor');
  $('monitor-status').textContent=(state.lastRun?'Last scan '+quoteDate(state.lastRun):'Waiting for first market-hours scan')+' • '+(state.candidates||[]).length+' watch-only candidates'+(state.running?' • scanning…':'')+(state.lastError?' • '+state.lastError:'');
  const recent=state.history||[];const latest=recent[0];const counts=latest?.tiers||{};
  const metric=$('monitor-metrics');if(metric)metric.textContent=latest?'Latest scan: '+latest.candidates+' candidates • '+(latest.confirmed||0)+' two-scan confirmed • '+['High Conviction','Actionable','Watchlist','Developing'].map(t=>t+': '+(counts[t]||0)).join(' · ')+' • '+recent.length+' scans in current server session':'No completed scan metrics yet';
  const events=state.alerts||[];
  if(monitorInitialized&&'Notification' in window&&Notification.permission==='granted'&&localStorage.getItem(notifyPreferenceKey)==='true'){
   for(const c of events){
    const id=c.id+'-'+c.checkedAt;
    if(!notifiedWatchIds.has(id)&&Date.now()-Date.parse(c.checkedAt)<120000){
     new Notification('Options Lab: watch candidate',{body:c.symbol+' '+c.side.toUpperCase()+' '+c.strike+' '+displayDate(c.expiry)+' — intraday breakout watch, not a buy signal'});
    }
   }
  }
  notifiedWatchIds=new Set(events.map(c=>c.id+'-'+c.checkedAt));monitorInitialized=true;
  // Opt-in local paper journal: indicative fills at quoted ask, never actual executions.
  if(localStorage.getItem('olab-auto-paper-enabled')==='true'){
   const rows=journalRead();
   let changed=false;
   for(const c of state.confirmed||[]){
    const id='auto-'+c.id+'-'+c.checkedAt.slice(0,10);
    if(rows.some(r=>r.id===id))continue;
    if(!Number.isFinite(c.ask)||c.ask<=0||c.ask*100>1000)continue;
    rows.unshift({id,symbol:c.symbol,side:c.side,strike:c.strike,expiry:c.expiry,entry:c.ask,createdAt:c.checkedAt,setupScore:c.setup?.score??null,setupTier:c.setup?.tier||'Unrated',quoteScore:c.setup?.factors?.[0]?.points??null,auto:true,entryAssumption:'Ask quote, hypothetical; no fill verified'});
    changed=true;
   }
   if(changed)journalWrite(rows);
  }
  const diagnostic=document.createElement('p');diagnostic.className='muted';diagnostic.textContent='Scanner diagnostics: '+(state.lastOutcome||'waiting')+' • '+(state.successfulScans||0)+' completed • '+(state.failedScans||0)+' failed'+(state.lastAttempt?' • Last attempt '+quoteDate(state.lastAttempt):' • Awaiting market-hours run')+'. Counts reset on service restart.';
  $('monitor-status').after(diagnostic);
  const old=$('monitor-status').parentNode.querySelectorAll('.scanner-diagnostic');
  old.forEach(el=>el.remove());diagnostic.classList.add('scanner-diagnostic');
  const box=$('monitor-results');box.replaceChildren();
  for(const c of state.candidates||[]){
   const p=document.createElement('p');p.className='muted';
   p.textContent=(c.setup?.tier||'Developing')+' '+(c.setup?.score??'—')+'/100 • '+c.symbol+' '+c.side.toUpperCase()+' '+c.strike+' '+displayDate(c.expiry)+' • '+money(c.premiumDollars)+'/contract • '+Number(c.changePercent).toFixed(2)+'% day • Breakout '+money(c.breakoutLevel)+' • Stock stop '+money(c.stopLevel)+' • Stock target '+money(c.targetLevel)+' • Volume '+(c.volumeRatio===null?'unavailable':c.volumeRatio+'x')+' • '+(c.classification||'WATCH ONLY');
   box.append(p);
  }
 }catch(e){$('monitor-status').textContent='Monitor unavailable: '+e.message}
}
refreshMonitor();setInterval(refreshMonitor,60000);

const autoPaperButton=$('auto-paper-toggle');
function refreshAutoPaperButton(){autoPaperButton.textContent=localStorage.getItem('olab-auto-paper-enabled')==='true'?'Auto paper tracking: ON':'Auto paper tracking: OFF'}
autoPaperButton.onclick=()=>{const on=localStorage.getItem('olab-auto-paper-enabled')==='true';localStorage.setItem('olab-auto-paper-enabled',String(!on));refreshAutoPaperButton()};
refreshAutoPaperButton();

let paperExitRunning=false;
async function checkPaperExits(){
 if(paperExitRunning||localStorage.getItem('olab-auto-exits-enabled')!=='true')return;
 const rows=journalRead(),open=rows.filter(x=>x.auto&&!Number.isFinite(x.exit)).slice(0,15);
 if(!open.length)return;
 paperExitRunning=true;
 let changed=false;
 try{
  for(const trade of open){
   try{
    const params=new URLSearchParams({symbol:trade.symbol,side:trade.side,expiry:trade.expiry,strike:String(trade.strike)});
    const quote=await api('/api/paper-quote?'+params);
    if(!quote.available)continue;
    const bid=Number(quote.bid),entry=Number(trade.entry);
    if(!Number.isFinite(bid)||!Number.isFinite(entry)||entry<=0)continue;
    const returnPct=(bid/entry-1)*100;
    const reason=returnPct<=-30?'Paper stop (-30%)':returnPct>=50?'Paper target (+50%)':null;
    if(!reason)continue;
    const target=rows.find(x=>x.id===trade.id);
    if(!target||Number.isFinite(target.exit))continue;
    target.exit=bid;target.closedAt=new Date().toISOString();target.exitReason=reason;target.exitQuoteTime=quote.quoteTime;target.exitAssumption='Bid quote, hypothetical; no execution verified';changed=true;
   }catch{}
  }
  if(changed)journalWrite(rows);
 }finally{paperExitRunning=false}
}
const autoExitsButton=$('auto-exits-toggle');
function updateAutoExitsButton(){autoExitsButton.textContent=localStorage.getItem('olab-auto-exits-enabled')==='true'?'Auto paper exits: ON':'Auto paper exits: OFF'}
autoExitsButton.onclick=()=>{localStorage.setItem('olab-auto-exits-enabled',String(localStorage.getItem('olab-auto-exits-enabled')!=='true'));updateAutoExitsButton();void checkPaperExits()};
updateAutoExitsButton();
void checkPaperExits();setInterval(checkPaperExits,60000);

function downloadJournalFile(filename,content,type){
 const url=URL.createObjectURL(new Blob([content],{type}));
 const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
$('paper-backup').onclick=()=>downloadJournalFile('options-lab-journal-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify({version:1,exportedAt:new Date().toISOString(),trades:journalRead()},null,2),'application/json');
$('paper-export').onclick=()=>{
 const fields=['id','symbol','side','strike','expiry','entry','exit','createdAt','closedAt','exitReason','setupScore','setupTier','quoteScore','auto','entryAssumption','exitAssumption'];
 const csv=[fields.join(','),...journalRead().map(t=>fields.map(k=>'"'+String(t[k]??'').replaceAll('"','""')+'"').join(','))].join('\r\n');
 downloadJournalFile('options-lab-trades-'+new Date().toISOString().slice(0,10)+'.csv',csv,'text/csv');
};
$('paper-import').onclick=()=>$('paper-import-file').click();
$('paper-import-file').onchange=async()=>{
 const input=$('paper-import-file'),file=input.files?.[0];if(!file)return;
 try{
  if(file.size>2000000)throw Error('Backup file is too large');
  const data=JSON.parse(await file.text());
  if(data.version!==1||!Array.isArray(data.trades)||data.trades.length>10000)throw Error('Invalid Options Lab backup');
  const valid=data.trades.every(t=>t&&typeof t.id==='string'&&/^[A-Z]{1,5}$/.test(t.symbol)&&['call','put'].includes(t.side)&&/^\d{4}-\d{2}-\d{2}$/.test(t.expiry)&&Number.isFinite(t.strike)&&t.strike>0&&Number.isFinite(t.entry)&&t.entry>0&&(t.exit===undefined||Number.isFinite(t.exit)&&t.exit>=0));
  if(!valid)throw Error('Backup contains invalid trades');
  if(!confirm('Restore '+data.trades.length+' trades? Existing trades with the same ID will be replaced.'))return;
  const merged=new Map(journalRead().map(t=>[t.id,t]));
  for(const t of data.trades)merged.set(t.id,t);
  journalWrite([...merged.values()]);
  alert('Journal restored. '+merged.size+' trades now saved on this device.');
 }catch(e){alert('Restore failed: '+e.message)}
 finally{input.value=''}
};

$('paper-sync').onclick=async()=>{
 const button=$('paper-sync');button.disabled=true;
 try{
  const local=journalRead();
  const remote=await api('/api/paper-journal');
  const deleted=JSON.parse(localStorage.getItem('olab-paper-deleted-v1')||'[]');
  if(deleted.length)await api('/api/paper-journal',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({ids:deleted})});
  const missing=local;
  if(missing.length)await api('/api/paper-journal',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({trades:missing})});
  const refreshed=await api('/api/paper-journal');
  const merged=new Map(local.map(t=>[t.id,t]));
  for(const t of refreshed.trades)if(!deleted.includes(t.id)&&(!merged.has(t.id)||(Number.isFinite(t.exit)&&!Number.isFinite(merged.get(t.id).exit))))merged.set(t.id,t);
  localStorage.setItem(journalKey,JSON.stringify([...merged.values()]));if(deleted.length)localStorage.removeItem('olab-paper-deleted-v1');renderJournal();
  const performance=await api('/api/performance');
  const localRows=journalRead();
  const localClosed=localRows.filter(t=>Number.isFinite(t.exit)).length;
  const match=performance.tracked===localRows.length&&performance.closed===localClosed;
  $('journal-storage-status').textContent='Database sync complete • '+performance.tracked+' saved server-side • '+performance.closed+' closed • '+performance.open+' open • '+(match?'Dashboard counts verified against PostgreSQL.':'Browser and database counts differ; review pending local changes.')+' Automatic sync enabled.';
 }catch(e){$('journal-storage-status').textContent='Sync failed: '+e.message+' • Your local journal remains intact.'}
 finally{button.disabled=false}
};

let journalSyncTimer;
function scheduleJournalSync(){clearTimeout(journalSyncTimer);journalSyncTimer=setTimeout(()=>{$('paper-sync').click()},900)}
setTimeout(()=>{$('paper-sync').click()},2000);


// Page navigation keeps existing panels mounted so live data and event handlers remain intact.
const appPages=['home','research','scanner','monitor','opportunities','performance','paper','settings'];
function showAppPage(name,historyMode='push'){
 const page=appPages.includes(name)?name:'home';
 for(const el of document.querySelectorAll('.app-page'))el.hidden=el.dataset.page!==page;
 for(const button of document.querySelectorAll('[data-go]')){const active=button.dataset.go===page;button.classList.toggle('active',active);button.setAttribute('aria-current',active?'page':'false')}
 if(historyMode==='push'&&location.hash!=='#'+page)history.pushState({page},'', '#'+page);
 document.title=(document.querySelector('.app-nav button.active')?.textContent||'Options Lab')+' | Options Lab';
 window.scrollTo({top:0,behavior:'instant'});
}
document.querySelectorAll('[data-go]').forEach(button=>button.addEventListener('click',()=>showAppPage(button.dataset.go)));
window.addEventListener('popstate',()=>showAppPage(location.hash.slice(1),'none'));
window.addEventListener('hashchange',()=>showAppPage(location.hash.slice(1),'none'));
showAppPage(location.hash.slice(1),'replace');
