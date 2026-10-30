// Options Lab: pure, read-only screening utilities. Never places orders.
export const SHORT_TERM_RULES = Object.freeze({
  minDTE: 0, maxDTE: 10, maxPremiumDollars: 1000,
  maxSpreadPct: 0.08, maxQuoteAgeSeconds: 30,
  minBidSize: 1, minAskSize: 1
});
export function screenContract(contract, {now=Date.now(), rules=SHORT_TERM_RULES}={}) {
  const reasons=[];
  const {symbol,expiry,bid,ask,bidSize,askSize,quoteTime}=contract;
  if(typeof symbol!=='string'||!symbol.trim()) reasons.push('missing-contract');
  const etParts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
  const et=Object.fromEntries(etParts.map(p=>[p.type,p.value]));
  const day=new Date(`${et.year}-${et.month}-${et.day}T12:00:00Z`);
  const expiration=typeof expiry==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(expiry)?new Date(expiry+'T12:00:00Z'):new Date(NaN);
  const dte=(expiration-day)/86400000;
  if(!Number.isInteger(dte)||dte<rules.minDTE||dte>rules.maxDTE) reasons.push('expiration');
  if(!Number.isFinite(bid)||!Number.isFinite(ask)||bid<=0||ask<=0||ask<bid) reasons.push('invalid-quote');
  if(!Number.isFinite(bidSize)||bidSize<rules.minBidSize||!Number.isFinite(askSize)||askSize<rules.minAskSize) reasons.push('liquidity');
  const age=now-Date.parse(quoteTime);
  if(!Number.isFinite(age)||age< -5000||age>rules.maxQuoteAgeSeconds*1000) reasons.push('stale-quote');
  const spread=Number.isFinite(bid)&&Number.isFinite(ask)&&bid>0&&ask>=bid?(ask-bid)/((ask+bid)/2):null;
  if(spread===null||spread>rules.maxSpreadPct) reasons.push('spread');
  const premium=Number.isFinite(ask)&&ask>0?ask*100:null;
  if(premium===null||premium>rules.maxPremiumDollars) reasons.push('premium-budget');
  return {symbol,expiry,dte:Number.isInteger(dte)?dte:null,spreadPct:spread,premiumDollars:premium,eligible:reasons.length===0,reasons,quoteTime};
}
export function rankContracts(contracts,opts={}) {
  return contracts.map(c=>screenContract(c,opts)).filter(c=>c.eligible)
    .sort((a,b)=>a.spreadPct-b.spreadPct||a.premiumDollars-b.premiumDollars);
}
