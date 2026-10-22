// Independent paper-v2 paper fills, no brokerage orders.
import {freshQuote,eastern} from './engine.mjs';
export const V2_RULES=Object.freeze({version:'paper-v2-shadow',maxPremiumDollars:1000,maxRiskDollars:75,maxSpread:0.025,minVolumeRatio:2,minDelta:0.45,maxDelta:0.60,minDTE:10,maxDTE:21,minimumTargetToRisk:1.8,stopLossFraction:0.12,profitTargetFraction:0.24,maxCorrelatedPositions:1,feePerContract:0.65,slippage:0.01});
export function assessV2(signal,contract,{existing=[],eventRisk=false}={}){
 const reasons=[];
 if(!signal||!contract)return {qualified:false,reasons:['missing-signal-or-contract'],version:V2_RULES.version};
 if(signal.setup==='Trend pullback'&&signal.volumeRatio<V2_RULES.minVolumeRatio)reasons.push('pullback-volume');
 if(!['Trend pullback','Opening range breakout','Opening range breakdown'].includes(signal.setup))reasons.push('unsupported-setup');
 if(!Number.isFinite(signal.risk)||signal.risk<=0||Math.abs(signal.target-signal.underlying)/signal.risk<V2_RULES.minimumTargetToRisk)reasons.push('underlying-reward-risk');
 if(eventRisk)reasons.push('scheduled-event-risk');
 const price=(contract.ask+V2_RULES.slippage)*100,delta=Math.abs(contract.greeks?.delta??NaN);
 if(!Number.isFinite(price)||price>V2_RULES.maxPremiumDollars)reasons.push('premium-budget');
 if(!Number.isFinite(contract.spread)||contract.spread>V2_RULES.maxSpread)reasons.push('spread');
 if(!Number.isFinite(delta)||delta<V2_RULES.minDelta||delta>V2_RULES.maxDelta)reasons.push('delta');
 if(!Number.isFinite(contract.dte)||contract.dte<V2_RULES.minDTE||contract.dte>V2_RULES.maxDTE)reasons.push('expiration');
 const risk=price*V2_RULES.stopLossFraction+2*V2_RULES.feePerContract;
 if(risk>V2_RULES.maxRiskDollars)reasons.push('risk-budget');
 if(existing.filter(p=>p.status==='open').length>=V2_RULES.maxCorrelatedPositions)reasons.push('portfolio-exposure');
 return {version:V2_RULES.version,qualified:reasons.length===0,reasons,plannedPremium:price,estimatedStopRisk:risk,profitTargetPremium:(contract.ask+V2_RULES.slippage)*(1+V2_RULES.profitTargetFraction),stopTriggerPremium:(contract.ask+V2_RULES.slippage)*(1-V2_RULES.stopLossFraction)};
}
export function openV2(signal,contract,now=Date.now()){
 const entryPremium=contract.ask+V2_RULES.slippage;
 return {...signal,id:signal.id.replace(/^paper-v1:/,'paper-v2-shadow:'),version:V2_RULES.version,contract,status:'open',openedAt:new Date(now).toISOString(),entryPremium,entryFee:V2_RULES.feePerContract,contracts:1,markPremium:contract.bid,fillModel:'Shadow buy ask + $0.01; sell bid - $0.01; $0.65 fee each way'};
}
export function exitReasonV2(p,underlying,q,minutesToClose,now=Date.now()){
 if(minutesToClose<=5)return 'End of session';
 if(q&&freshQuote(q,now)){
  if(q.bp<=p.entryPremium*(1-V2_RULES.stopLossFraction))return 'V2 premium stop';
  if(q.bp>=p.entryPremium*(1+V2_RULES.profitTargetFraction))return 'V2 premium target';
 }
 if(Number.isFinite(underlying)){
  if(p.side==='call'&&underlying<=p.stop||p.side==='put'&&underlying>=p.stop)return 'Underlying invalidation';
  if(p.side==='call'&&underlying>=p.target||p.side==='put'&&underlying<=p.target)return 'Underlying 2R target';
 }
 return null;
}
export function closeV2(p,q,reason,now=Date.now()){
 if(!freshQuote(q,now))return {...p,pendingExit:reason};
 const exitPremium=Math.max(0,q.bp-V2_RULES.slippage);
 return {...p,status:'closed',closedAt:new Date(now).toISOString(),exitPremium,exitQuoteTime:q.t,exitReason:reason,pendingExit:null,pnl:(exitPremium-p.entryPremium)*100-p.entryFee-V2_RULES.feePerContract,exitFee:V2_RULES.feePerContract};
}
export function compareVersions(v1Journal=[],v2Journal=[],shadowDecisions=[]){
 const summarize=journal=>{const closed=journal.filter(p=>p.status==='closed'),wins=closed.filter(p=>p.pnl>0),losses=closed.filter(p=>p.pnl<0),sum=a=>a.reduce((s,p)=>s+p.pnl,0);return {trades:closed.length,open:journal.filter(p=>p.status==='open').length,netPnl:sum(closed),winRate:closed.length?wins.length/closed.length:null,averageWin:wins.length?sum(wins)/wins.length:null,averageLoss:losses.length?sum(losses)/losses.length:null};};
 const rejected={};for(const d of shadowDecisions)for(const reason of d.reasons||[])rejected[reason]=(rejected[reason]||0)+1;
 return {v1:summarize(v1Journal),v2:{...summarize(v2Journal),mode:'independent-paper-simulation',evaluated:shadowDecisions.length,qualified:shadowDecisions.filter(d=>d.qualified).length,rejected},note:'Both versions use simulated bid/ask fills; v2 premium stops are not guaranteed fills. Compare over enough market sessions, not only raw win rate.'};
}

export function selectV2Contract(chain,signal,now=Date.now()){
 const today=eastern(now).date,candidates=[];
 for(const [symbol,s] of Object.entries(chain||{})){
  const m=symbol.match(/^(\\w+)(\\d{6})([CP])(\\d{8})$/);
  if(!m||m[1]!==signal.symbol||m[3]!== (signal.side==='call'?'C':'P'))continue;
  const expiry='20'+m[2].slice(0,2)+'-'+m[2].slice(2,4)+'-'+m[2].slice(4,6);
  const dte=(Date.parse(expiry+'T12:00Z')-Date.parse(today+'T12:00Z'))/86400000;
  const q=s.latestQuote,g=s.greeks;
  if(!freshQuote(q,now)||!g||!['delta','gamma','theta','vega'].every(k=>Number.isFinite(g[k]))||!Number.isFinite(s.impliedVolatility)||s.impliedVolatility<=0)continue;
  const delta=Math.abs(g.delta),spread=(q.ap-q.bp)/((q.ap+q.bp)/2);
  if(dte<V2_RULES.minDTE||dte>V2_RULES.maxDTE||delta<V2_RULES.minDelta||delta>V2_RULES.maxDelta||spread>V2_RULES.maxSpread||q.ap+V2_RULES.slippage>V2_RULES.maxPremiumDollars/100)continue;
  if(signal.side==='call'&&g.delta<=0||signal.side==='put'&&g.delta>=0)continue;
  candidates.push({symbol,expiry,strike:+m[4]/1000,bid:q.bp,ask:q.ap,quoteTime:q.t,spread,greeks:g,iv:s.impliedVolatility,dte,bidSize:q.bs,askSize:q.as});
 }
 return candidates.sort((a,b)=>Math.abs(Math.abs(a.greeks.delta)-0.5)-Math.abs(Math.abs(b.greeks.delta)-0.5)||a.spread-b.spread)[0]||null;
}
