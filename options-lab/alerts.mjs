// Deduplicated alert planning. Delivery will be connected to authenticated push infrastructure.
export function buildOpportunityAlert({id,contract,quoteTime,entry,stop,target,validUntil,reason,source}) {
  if(!id||!contract||!quoteTime||!validUntil||!source)throw Error('Incomplete alert');
  if(![entry,stop,target].every(x=>Number.isFinite(x)&&x>=0))throw Error('Invalid alert levels');
  if(Date.parse(validUntil)<=Date.parse(quoteTime))throw Error('Alert expired at quote time');
  return Object.freeze({
    id,kind:'trade-opportunity',contract,quoteTime,entry,stop,target,validUntil,reason:reason||'',
    source,status:'candidate',requiresFreshQuoteRecheck:true,autoExecute:false
  });
}
export function shouldNotify(alert,{now=Date.now(),seenIds=new Set()}={}) {
  return !seenIds.has(alert.id)&&Number.isFinite(Date.parse(alert.validUntil))&&Date.parse(alert.validUntil)>now;
}
