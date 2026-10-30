import pg from 'pg';
const {Pool}=pg;
const pool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:6000}):null;
export const journalConfigured=()=>!!pool;
export async function initJournal(){
 if(!pool)return false;
 await pool.query(`CREATE TABLE IF NOT EXISTS paper_quote_samples (trade_id text NOT NULL, quote_time timestamptz NOT NULL, bid numeric NOT NULL CHECK (bid>=0), ask numeric, bid_size numeric, recorded_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (trade_id,quote_time))`);
 await pool.query(`CREATE INDEX IF NOT EXISTS paper_quote_samples_trade_time_idx ON paper_quote_samples (trade_id,quote_time)`);
 await pool.query(`CREATE TABLE IF NOT EXISTS scanner_diagnostics (id bigserial PRIMARY KEY, checked_at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL)`);
 await pool.query(`CREATE TABLE IF NOT EXISTS paper_trades (trade_id text PRIMARY KEY, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
 return true;
}
function validate(t){
 if(!t||typeof t!=='object'||Array.isArray(t)||typeof t.id!=='string'||t.id.length<1||t.id.length>160||!/^[A-Z]{1,5}$/.test(t.symbol)||!['call','put'].includes(t.side)||!/^\d{4}-\d{2}-\d{2}$/.test(t.expiry)||!Number.isFinite(t.strike)||t.strike<=0||!Number.isFinite(t.entry)||t.entry<=0||t.entry>10||!Number.isFinite(Date.parse(t.createdAt)))throw Error('Invalid paper trade');
 if(t.exit!==undefined&&t.exit!==null&&(!Number.isFinite(t.exit)||t.exit<0))throw Error('Invalid paper exit');
 return t;
}
export async function listJournal(){
 if(!pool)throw Error('Journal database not configured');
 const r=await pool.query('SELECT payload FROM paper_trades ORDER BY created_at DESC LIMIT 1000');
 return r.rows.map(x=>x.payload);
}
export async function mergeJournal(trades){
 if(!pool)throw Error('Journal database not configured');
 if(!Array.isArray(trades)||trades.length>1000)throw Error('Invalid journal batch');
 const rows=trades.map(validate);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  let inserted=0;
  for(const t of rows){
   const result=await client.query(`INSERT INTO paper_trades(trade_id,payload) VALUES ($1,$2::jsonb) ON CONFLICT (trade_id) DO UPDATE SET payload=CASE WHEN paper_trades.payload ? 'exit' AND NOT (EXCLUDED.payload ? 'exit') THEN paper_trades.payload ELSE EXCLUDED.payload END, updated_at=now() RETURNING trade_id`,[t.id,JSON.stringify(t)]);
   inserted+=result.rowCount;
  }
  await client.query('COMMIT');
  return {inserted,submitted:rows.length};
 }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}

export async function deleteJournal(ids){
 if(!pool)throw Error('Journal database not configured');
 if(!Array.isArray(ids)||ids.length>1000||!ids.every(id=>typeof id==='string'&&id.length>0&&id.length<=160))throw Error('Invalid deletion request');
 if(!ids.length)return {deleted:0};
 const result=await pool.query('DELETE FROM paper_trades WHERE trade_id = ANY($1::text[])',[ids]);
 return {deleted:result.rowCount};
}

export async function closePaperTrade(id,exit,reason,quoteTime){
 if(!pool)throw Error('Journal database not configured');
 if(typeof id!=='string'||!Number.isFinite(exit)||exit<0)throw Error('Invalid paper close');
 const closedAt=new Date().toISOString();
 const result=await pool.query(`UPDATE paper_trades SET payload=jsonb_set(payload,'{exit}',to_jsonb($2::numeric),true) || jsonb_build_object('closedAt',$3::text,'exitReason',$4::text,'exitQuoteTime',$5::text,'exitAssumption','Bid quote, hypothetical; no execution verified'),updated_at=now() WHERE trade_id=$1 AND NOT (payload ? 'exit') RETURNING trade_id`,[id,exit,closedAt,reason,quoteTime]);
 return result.rowCount>0;
}

export async function saveScannerDiagnostic(payload){
 if(!pool) return;
 await pool.query('INSERT INTO scanner_diagnostics(payload) VALUES ($1::jsonb)',[JSON.stringify(payload)]);
 await pool.query('DELETE FROM scanner_diagnostics WHERE id IN (SELECT id FROM scanner_diagnostics ORDER BY id DESC OFFSET 500)');
}
export async function listScannerDiagnostics(){
 if(!pool)return [];
 const r=await pool.query('SELECT payload FROM scanner_diagnostics ORDER BY id DESC LIMIT 100');
 return r.rows.map(x=>x.payload);
}

export async function recordPaperQuote(tradeId,quote){
 if(!pool)throw Error('Journal database not configured');
 if(typeof tradeId!=='string'||tradeId.length>160||!Number.isFinite(quote.bid)||quote.bid<0||!Number.isFinite(quote.bidSize)||quote.bidSize<1) return false;
 const timestamp=Date.parse(quote.quoteTime);
 if(!Number.isFinite(timestamp)||timestamp>Date.now()+5000||Date.now()-timestamp>30000)return false;
 await pool.query('INSERT INTO paper_quote_samples(trade_id,quote_time,bid,ask,bid_size) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[tradeId,new Date(timestamp),quote.bid,Number.isFinite(quote.ask)?quote.ask:null,quote.bidSize]);
 return true;
}
export async function paperQuoteCoverage(){
 if(!pool)throw Error('Journal database not configured');
 const r=await pool.query('SELECT trade_id, count(*)::int AS samples, min(quote_time) AS first_quote, max(quote_time) AS last_quote FROM paper_quote_samples GROUP BY trade_id ORDER BY max(quote_time) DESC LIMIT 1000');
 return r.rows.map(x=>({tradeId:x.trade_id,samples:x.samples,firstQuote:x.first_quote,lastQuote:x.last_quote}));
}

export async function paperQuoteQuality(){
 if(!pool)throw Error('Journal database not configured');
 const r=await pool.query(`WITH ordered AS (
 SELECT trade_id,quote_time,bid,ask,bid_size,
 EXTRACT(EPOCH FROM (quote_time-lag(quote_time) OVER(PARTITION BY trade_id ORDER BY quote_time))) AS gap_seconds
 FROM paper_quote_samples
 ), aggregates AS (
 SELECT trade_id,count(*)::int AS samples,min(quote_time) AS first_quote,max(quote_time) AS last_quote,
 count(*) FILTER (WHERE gap_seconds>90)::int AS gaps_over_90s,
 coalesce(max(gap_seconds),0)::float AS max_gap_seconds,
 count(*) FILTER (WHERE ask IS NOT NULL AND ask<bid)::int AS crossed_quotes,
 count(*) FILTER (WHERE ask IS NOT NULL AND ask>0 AND (ask-bid)/ask>0.15)::int AS wide_spread_quotes
 FROM ordered GROUP BY trade_id
 ) SELECT * FROM aggregates ORDER BY last_quote DESC LIMIT 1000`);
 return r.rows.map(x=>({tradeId:x.trade_id,samples:x.samples,firstQuote:x.first_quote,lastQuote:x.last_quote,gapsOver90s:x.gaps_over_90s,maxGapSeconds:x.max_gap_seconds,crossedQuotes:x.crossed_quotes,wideSpreadQuotes:x.wide_spread_quotes}));
}
export async function replayObservedQuotes(limit=100){
 if(!pool)throw Error('Journal database not configured');
 const result=await pool.query(`SELECT t.trade_id,t.payload,q.quote_time,q.bid FROM paper_trades t JOIN paper_quote_samples q ON q.trade_id=t.trade_id WHERE t.payload ? 'exit' ORDER BY t.created_at DESC,q.quote_time ASC LIMIT 10000`);
 const groups=new Map();
 for(const row of result.rows){if(!groups.has(row.trade_id)){if(groups.size>=limit)continue;groups.set(row.trade_id,{trade:row.payload,quotes:[]})}groups.get(row.trade_id).quotes.push({time:row.quote_time,bid:Number(row.bid)})}
 const rules=[{name:'Current -30% / +50%',stop:-30,target:50},{name:'Alternative -20% / +40%',stop:-20,target:40},{name:'Alternative -25% / +60%',stop:-25,target:60}];
 return {source:'observed_bid_snapshots',continuous:false,notice:'Observed threshold touches only. No inference between snapshots; outcomes are not complete counterfactual returns.',rules:rules.map(rule=>({name:rule.name,stop:rule.stop,target:rule.target,observedTouches:[...groups.values()].reduce((acc,{trade,quotes})=>{if(!Number.isFinite(trade.entry)||trade.entry<=0||quotes.length<2)return acc;const hit=quotes.find(q=>q.bid<=trade.entry*(1+rule.stop/100)||q.bid>=trade.entry*(1+rule.target/100));if(hit){acc.push({tradeId:trade.id,observedAt:hit.time,observedBid:hit.bid,trigger:hit.bid<=trade.entry*(1+rule.stop/100)?'stop':'target',snapshots:quotes.length})}return acc},[])})),tradesWithSamples:groups.size};
}
