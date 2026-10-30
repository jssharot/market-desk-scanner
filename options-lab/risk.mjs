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

export function scoreContract(contract,{underlyingPrice=null,now=Date.now(),rules=SHORT_TERM_RULES}={}) {
  const screen=screenContract(contract,{now,rules});
  if(!screen.eligible)return {...screen,score:0,tier:'Rejected',factors:[]};
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  const spreadScore=30*(1-clamp(screen.spreadPct/rules.maxSpreadPct,0,1));
  const depth=Math.min(contract.bidSize,contract.askSize);
  const depthScore=20*clamp(Math.log2(depth+1)/Math.log2(17),0,1);
  const age=now-Date.parse(contract.quoteTime);
  const freshnessScore=15*(1-clamp(Math.max(0,age)/(rules.maxQuoteAgeSeconds*1000),0,1));
  const distance=Number.isFinite(underlyingPrice)&&underlyingPrice>0&&Number.isFinite(contract.strike)
    ?Math.abs(contract.strike-underlyingPrice)/underlyingPrice:null;
  const strikeScore=distance===null?10:20*(1-clamp(distance/0.1,0,1));
  const budgetScore=15*(1-clamp(screen.premiumDollars/rules.maxPremiumDollars,0,1));
  const score=Math.round(spreadScore+depthScore+freshnessScore+strikeScore+budgetScore);
  const tier=score>=80?'High Conviction':score>=65?'Actionable':score>=45?'Watchlist':'Rejected';
  return {...screen,score,tier,factors:[
    {name:'Spread',points:Math.round(spreadScore)},
    {name:'Quote depth',points:Math.round(depthScore)},
    {name:'Quote freshness',points:Math.round(freshnessScore)},
    {name:'Strike proximity',points:Math.round(strikeScore)},
    {name:'Premium headroom',points:Math.round(budgetScore)}
  ],scoreNotice:'Liquidity and price-quality research score, not a directional signal or probability of profit.'};
}

export function scoreSetup({quoteScore,changePercent,volumeRatio=null,breakoutConfirmed=false}={}) {
  if(!Number.isFinite(quoteScore)||quoteScore<=0)return {score:0,tier:'Rejected',direction:null,confirmation:'unavailable'};
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const move=Number.isFinite(changePercent)?Math.abs(changePercent):0;
  const momentum=30*clamp(move/4,0,1);
  const volume=Number.isFinite(volumeRatio)&&volumeRatio>=0?20*clamp(volumeRatio/1.5,0,1):0;
  const breakout=breakoutConfirmed?15:0;
  const quality=35*clamp(quoteScore/100,0,1);
  const raw=Math.round(momentum+volume+breakout+quality);
  // Without independently confirmed intraday volume and breakout, never label a trade high conviction.
  const score=breakoutConfirmed&&Number.isFinite(volumeRatio)?raw:Math.min(raw,79);
  const tier=score>=80?'High Conviction':score>=65?'Actionable':score>=45?'Watchlist':'Developing';
  return {score,tier,direction:changePercent>0?'call':changePercent<0?'put':null,
    confirmation:breakoutConfirmed&&Number.isFinite(volumeRatio)?'technical-confirmed':'momentum-only',
    factors:[{name:'Option quote quality',points:Math.round(quality)},
      {name:'Stock momentum',points:Math.round(momentum)},
      {name:'Relative bar volume',points:Math.round(volume)},
      {name:'Breakout confirmation',points:breakout}],
    note:'Research ranking only; not a probability of profit or verified entry.'};
}
