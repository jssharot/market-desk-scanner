const $=id=>document.getElementById(id);
const savedKey=localStorage.getItem('olab-key')||sessionStorage.getItem('olab-key')||'';
if(savedKey){$('key').value=savedKey;$('key-status').textContent='Access key remembered on this device.';$('access-summary').textContent='Saved'}else{$('access-panel').open=true;$('access-summary').textContent='Setup required'}
$('save-key').onclick=()=>{const key=$('key').value.trim();if(!key){$('key-status').textContent='Enter an access key first.';return}localStorage.setItem('olab-key',key);sessionStorage.removeItem('olab-key');$('key-status').textContent='Saved. You will stay signed in on this browser.';$('access-summary').textContent='Saved';$('access-panel').open=false};
$('forget-key').onclick=()=>{localStorage.removeItem('olab-key');sessionStorage.removeItem('olab-key');$('key').value='';$('key-status').textContent='Saved key removed from this browser.';$('access-summary').textContent='Setup required';$('access-panel').open=true};
async function api(path,options={}){const key=localStorage.getItem('olab-key')||sessionStorage.getItem('olab-key')||'';const r=await fetch(path,{...options,headers:{'x-options-lab-key':key,...(options.headers||{})}});const j=await r.json();if(!r.ok)throw Error(j.error||'Request failed');return j}
$('load').onclick=async()=>{try{const symbol=$('symbol').value.trim().toUpperCase();$('status').textContent='Loading…';const j=await api('/api/expirations?symbol='+encodeURIComponent(symbol));const today=Date.parse(new Date().toISOString().slice(0,10)+'T12:00:00Z');const ex=(j.expirations||[]).filter(x=>{const d=(Date.parse(x+'T12:00:00Z')-today)/86400000;return d>=0&&d<=10});$('expiry').replaceChildren(...ex.map(e=>new Option(e,e)));$('status').textContent=ex.length+' short-term expirations';}catch(e){$('status').textContent=e.message}};
let lastContracts=[];
const money=n=>Number.isFinite(n)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n):'—';
const quoteTime=t=>{const ms=Date.parse(t||'');return Number.isFinite(ms)?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(ms):'Unavailable'};
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
 const symbol=$('symbol').value.trim().toUpperCase(),expiry=$('expiry').value,side=$('side').value;
 if(!expiry)throw Error('Select expiration');
 $('status').textContent='Loading contracts…';
 const j=await api('/api/chain?symbol='+encodeURIComponent(symbol)+'&expiry='+expiry+'&side='+side);
 lastContracts=j.screened||[];
 renderChain();
 $('status').textContent=lastContracts.length+' contracts • Retrieved '+quoteTime(j.checkedAt)+' • Screening is not a trade recommendation';
}catch(e){$('status').textContent=e.message}};

$('ask').onclick=()=>{$('answer').textContent='AI assistant backend is not yet configured. No live analysis has been performed.'};