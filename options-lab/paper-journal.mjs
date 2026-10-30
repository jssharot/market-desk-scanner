import pg from 'pg';
const {Pool}=pg;
const pool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:6000}):null;
export const journalConfigured=()=>!!pool;
export async function initJournal(){
 if(!pool)return false;
 await pool.query(`CREATE TABLE IF NOT EXISTS paper_trades (trade_id text PRIMARY KEY, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
 return true;
}
function validate(t){
 if(!t||typeof t!=='object'||Array.isArray(t)||typeof t.id!=='string'||t.id.length<1||t.id.length>160||!/^[A-Z]{1,5}$/.test(t.symbol)||!['call','put'].includes(t.side)||!/^\\d{4}-\\d{2}-\\d{2}$/.test(t.expiry)||!Number.isFinite(t.strike)||t.strike<=0||!Number.isFinite(t.entry)||t.entry<=0||t.entry>10||!Number.isFinite(Date.parse(t.createdAt)))throw Error('Invalid paper trade');
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
   const result=await client.query('INSERT INTO paper_trades(trade_id,payload) VALUES ($1,$2::jsonb) ON CONFLICT (trade_id) DO UPDATE SET payload=EXCLUDED.payload, updated_at=now() RETURNING trade_id',[t.id,JSON.stringify(t)]);
   inserted+=result.rowCount;
  }
  await client.query('COMMIT');
  return {inserted,submitted:rows.length};
 }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}
