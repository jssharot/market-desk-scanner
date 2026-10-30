export function paperExitDecision(trade,quote,now=Date.now()){
 if(!trade||Number.isFinite(trade.exit)||!Number.isFinite(trade.entry)||trade.entry<=0)return null;
 if(!quote||!Number.isFinite(quote.bid)||quote.bid<0||!Number.isFinite(quote.bidSize)||quote.bidSize<1)return null;
 const age=now-Date.parse(quote.quoteTime);
 if(!Number.isFinite(age)||age< -5000||age>30000)return null;
 const pct=(quote.bid/trade.entry-1)*100;
 return pct<=-30?'Paper stop (-30%)':pct>=50?'Paper target (+50%)':null;
}
export function paperEntryCandidate(c,existingIds,checkedAt,now=Date.now()){
 const id='server-auto-'+c.id+'-'+checkedAt.slice(0,10);
 if(existingIds.has(id)||!['High Conviction','Actionable'].includes(c.setup?.tier))return null;
 if(!Number.isFinite(c.ask)||c.ask<=0||c.ask*100>1000||!Number.isFinite(c.bid)||c.bid<=0||!Number.isFinite(c.spreadPct)||c.spreadPct>15)return null;
 const age=now-Date.parse(c.quoteTime);
 if(!Number.isFinite(age)||age< -5000||age>30000)return null;
 return {id,symbol:c.symbol,side:c.side,expiry:c.expiry,strike:c.strike,entry:c.ask,createdAt:checkedAt,auto:true,source:'server-confirmed-breakout',setupScore:c.setup.score,setupTier:c.setup.tier,entryQuoteTime:c.quoteTime,entryAssumption:'Quoted ask, hypothetical one-contract entry; no execution verified'};
}
