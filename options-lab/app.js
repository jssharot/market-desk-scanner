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
function journalWrite(rows){localStorage.setItem(journalKey,JSON.stringify(rows));renderJournal()}
function renderJournal(){
 const rows=journalRead(),closed=rows.filter(x=>Number.isFinite(x.exit));
 const pnl=closed.reduce((n,x)=>n+(x.exit-x.entry)*100,0);
 $('journal-stats').textContent=rows.length+' tracked • '+closed.length+' closed • '+(closed.length?(100*closed.filter(x=>x.exit>x.entry).length/closed.length).toFixed(0)+'% win rate • ':'')+'Realized P/L '+(pnl>=0?'+':'')+money(pnl);
 $('journal-rows').replaceChildren(...rows.map(x=>{
  const tr=document.createElement('tr');
  for(const value of [x.symbol+' '+x.expiry+' '+x.side+' '+x.strike,money(x.entry),Number.isFinite(x.exit)?money(x.exit):'Open',Number.isFinite(x.exit)?((x.exit/x.entry-1)*100).toFixed(1)+'%':'—']){
   const td=document.createElement('td');td.textContent=value;tr.append(td);
  }
  const td=document.createElement('td'),b=document.createElement('button');
  b.textContent=Number.isFinite(x.exit)?'Remove':'Close';
  b.onclick=()=>{
   const all=journalRead(),index=all.findIndex(y=>y.id===x.id);if(index<0)return;
   if(Number.isFinite(x.exit)){if(!confirm('Remove this paper trade?'))return;all.splice(index,1)}
   else{const value=prompt('Paper exit option premium per share (e.g. 2.50):');if(value===null)return;const exit=Number(value);if(!Number.isFinite(exit)||exit<0){alert('Enter a valid premium');return}all[index].exit=exit}
   journalWrite(all);
  };
  td.append(b);tr.append(td);return tr;
 }));
}
renderJournal();
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
    const label=document.createElement('span');label.textContent=c.side.toUpperCase()+' '+c.strike+' • '+displayDate(item.expiry)+' • Ask '+money(c.ask)+' • '+money(c.screen.premiumDollars)+'/contract';
    const btn=document.createElement('button');btn.textContent='Paper track';btn.onclick=()=>{
     const entry=Number(c.ask);if(!Number.isFinite(entry)||entry<=0)return;
     const rows=journalRead();rows.unshift({id:Date.now()+'-'+Math.random(),symbol:item.symbol,side:c.side,strike:c.strike,expiry:item.expiry,entry,createdAt:new Date().toISOString()});journalWrite(rows);btn.disabled=true;btn.textContent='Tracked';
    };line.append(label,btn);section.append(line);
   }
   results.append(section);
  }
  $('opportunities-status').textContent=count+' eligible contracts across '+(data.candidates||[]).length+' movers • Checked '+quoteDate(data.checkedAt)+' • Not trade alerts';
 }catch(e){$('opportunities-status').textContent=e.message}
 finally{$('scan-options').disabled=false}
};
