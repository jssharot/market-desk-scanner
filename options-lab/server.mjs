import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {screenContract} from './risk.mjs';
const base=process.env.MARKET_DESK_BACKEND_URL||'https://market-desk-paper-scanner.onrender.com';
const secret=process.env.MARKET_DESK_SHARED_SECRET;
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
if(req.method==='GET'&&u.pathname==='/api/expirations'){const q=new URL('/market/options/expirations',base);q.searchParams.set('symbol',symbol(u.searchParams.get('symbol')));return send(res,200,await upstream(q.pathname+q.search))}
if(req.method==='GET'&&u.pathname==='/api/chain'){const sym=symbol(u.searchParams.get('symbol')),date=expiry(u.searchParams.get('expiry')),side=u.searchParams.get('side');if(!['call','put'].includes(side))throw Error('Invalid side');const q=new URL('/market/options/chain',base);for(const [k,v] of Object.entries({symbol:sym,expiry:date,side}))q.searchParams.set(k,v);const j=await upstream(q.pathname+q.search);return send(res,200,{...j,screened:(j.contracts||[]).map(c=>({...c,screen:screenContract({...c,expiry:date})}))})}
return send(res,404,{error:'Not found'})
}catch(e){send(res,400,{error:e.message})}
}).listen(Number(process.env.PORT||10000),'0.0.0.0');