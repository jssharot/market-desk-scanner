const $=id=>document.getElementById(id);
const savedKey=localStorage.getItem('olab-key')||sessionStorage.getItem('olab-key')||'';
if(savedKey){$('key').value=savedKey;$('key-status').textContent='Access key remembered on this device.';$('access-summary').textContent='Saved'}else{$('access-panel').open=true;$('access-summary').textContent='Setup required'}
$('save-key').onclick=()=>{const key=$('key').value.trim();if(!key){$('key-status').textContent='Enter an access key first.';return}localStorage.setItem('olab-key',key);sessionStorage.removeItem('olab-key');$('key-status').textContent='Saved. You will stay signed in on this browser.';$('access-summary').textContent='Saved';$('access-panel').open=false};
$('forget-key').onclick=()=>{localStorage.removeItem('olab-key');sessionStorage.removeItem('olab-key');$('key').value='';$('key-status').textContent='Saved key removed from this browser.';$('access-summary').textContent='Setup required';$('access-panel').open=true};
async function api(path,options={}){const key=localStorage.getItem('olab-key')||sessionStorage.getItem('olab-key')||'';const r=await fetch(path,{...options,headers:{'x-options-lab-key':key,...(options.headers||{})}});const j=await r.json();if(!r.ok)throw Error(j.error||'Request failed');return j}
const displayDate=iso=>{const match=/^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(String(iso||''));return match?match[2]+'/'+match[3]+'/'+match[1]:(iso||'—')};
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
let selectedSymbol='SPY',searchTimer=null,searchSequence=0;
const input=$('symbol'),suggestions=$('ticker-suggestions');
const quoteDate=t=>{const ms=Date.parse(t||'');return Number.isFinite(ms)?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'2-digit',day:'2-digit',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(ms):'Unavailable'};
function hideSuggestions(){suggestions.hidden=true;suggestions.replaceChildren()}
async function showQuote(symbol){
 $('stock-quote').hidden=true;
 try{
  const j=await api('/api/stock-quote?symbol='+encodeURIComponent(symbol)),q=j.quote;
  if(!q||q.unavailable||!Number.isFinite(q.price))return;
  $('stock-price').textContent=symbol+' '+money(q.price);
  const pct=Number(q.changePercent),change=Number(q.change);
  $('stock-change').textContent=Number.isFinite(pct)?(pct>=0?'+':'')+pct.toFixed(2)+'%'+(Number.isFinite(change)?' ('+(change>=0?'+':'')+money(change)+')':''):'Change unavailable';
  $('stock-change').className=Number.isFinite(pct)?(pct>=0?'positive':'negative'):'';
  $('stock-asof').textContent='As of '+quoteDate(q.asOf)+' · '+(q.stale?'Stale last trade · ':'')+(j.source||'Alpaca SIP');
  $('stock-quote').hidden=false;
 }catch(e){$('stock-quote').hidden=true}
}
input.addEventListener('input',()=>{
 const q=input.value.trim();selectedSymbol='';clearTimeout(searchTimer);const id=++searchSequence;hideSuggestions();
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
    b.onclick=()=>{selectedSymbol=item.symbol;input.value=item.symbol;hideSuggestions();$('expiry').replaceChildren();$('quotes').replaceChildren();$('stock-quote').hidden=true;showQuote(item.symbol)};
    return b;
   }));suggestions.hidden=!items.length;
  }catch(e){hideSuggestions()}
 },250);
});
input.addEventListener('keydown',e=>{if(e.key==='Escape')hideSuggestions();if(e.key==='Enter'&&!suggestions.hidden){const first=suggestions.querySelector('button');if(first){e.preventDefault();first.click()}}});
document.addEventListener('click',e=>{if(!e.target.closest('.ticker-field'))hideSuggestions()});
$('clear-research').onclick=()=>{clearTimeout(searchTimer);++searchSequence;selectedSymbol='';input.value='';$('expiry').replaceChildren();$('quotes').replaceChildren();lastContracts=[];hideSuggestions();$('stock-quote').hidden=true;$('status').textContent='';$('chain-count').textContent='';input.focus()};
$('load').onclick=async()=>{try{const symbol=(selectedSymbol||$('symbol').value.trim().toUpperCase());if(!/^[A-Z]{1,5}$/.test(symbol))throw Error('Select a ticker from suggestions');input.value=symbol;hideSuggestions();showQuote(symbol);$('status').textContent='Loading…';const j=await api('/api/expirations?symbol='+encodeURIComponent(symbol));const today=Date.parse(new Date().toISOString().slice(0,10)+'T12:00:00Z');const ex=(j.expirations||[]).filter(x=>{const d=(Date.parse(x+'T12:00:00Z')-today)/86400000;return d>=0&&d<=10});$('expiry').replaceChildren(...ex.map(e=>new Option(displayDate(e),e)));$('status').textContent=ex.length+' short-term expirations';}catch(e){$('status').textContent=e.message}};
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

$('ask').onclick=()=>{$('answer').textContent='AI assistant backend is not yet configured. No live analysis has been performed.'};