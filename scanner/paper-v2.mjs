// Independent paper-v2 shadow qualification. Does not place orders or mutate paper-v1.
export const V2_RULES=Object.freeze({version:'paper-v2-shadow',maxPremiumDollars:1000,maxRiskDollars:75,maxSpread:0.025,minVolumeRatio:2,minDelta:0.45,maxDelta:0.60,minDTE:10,maxDTE:21,minimumTargetToRisk:1.8,stopLossFraction:0.12,profitTargetFraction:0.24,maxCorrelatedPositions:1});
export function assessV2(signal,contract,{existing=[],eventRisk=false}={}){
 const reasons=[];
 if(!signal||!contract)return {qualified:false,reasons:['missing-signal-or-contract'],version:V2_RULES.version};
 if(signal.setup==='Trend pullback'&&signal.volumeRatio<V2_RULES.minVolumeRatio)reasons.push('pullback-volume');
 if(!['Trend pullback','Opening range breakout','Opening range breakdown'].includes(signal.setup))reasons.push('unsupported-setup');
 if(!Number.isFinite(signal.risk)||signal.risk<=0||Math.abs(signal.target-signal.underlying)/signal.risk<V2_RULES.minimumTargetToRisk)reasons.push('underlying-reward-risk');
 if(eventRisk)reasons.push('scheduled-event-risk');
 const price=(contract.ask+0.01)*100,delta=Math.abs(contract.greeks?.delta??NaN);
 if(!Number.isFinite(price)||price>V2_RULES.maxPremiumDollars)reasons.push('premium-budget');
 if(!Number.isFinite(contract.spread)||contract.spread>V2_RULES.maxSpread)reasons.push('spread');
 if(!Number.isFinite(delta)||delta<V2_RULES.minDelta||delta>V2_RULES.maxDelta)reasons.push('delta');
 if(!Number.isFinite(contract.dte)||contract.dte<V2_RULES.minDTE||contract.dte>V2_RULES.maxDTE)reasons.push('expiration');
 // A premium-based stop is only a monitoring trigger, never a guaranteed fill.
 const risk=price*V2_RULES.stopLossFraction+1.30;
 if(risk>V2_RULES.maxRiskDollars)reasons.push('risk-budget');
 if(existing.filter(p=>p.status==='open'&&p.version===V2_RULES.version).length>=V2_RULES.maxCorrelatedPositions)reasons.push('portfolio-exposure');
 return {version:V2_RULES.version,qualified:reasons.length===0,reasons,plannedPremium:price,estimatedStopRisk:risk,profitTargetPremium:(contract.ask+0.01)*(1+V2_RULES.profitTargetFraction),stopTriggerPremium:(contract.ask+0.01)*(1-V2_RULES.stopLossFraction)};
}
export function compareVersions(v1Journal=[],shadowDecisions=[]){
 const closed=v1Journal.filter(p=>p.status==='closed');
 const wins=closed.filter(p=>p.pnl>0),losses=closed.filter(p=>p.pnl<0);
 const sum=a=>a.reduce((s,p)=>s+p.pnl,0);
 const rejected={};for(const d of shadowDecisions)for(const reason of d.reasons||[])rejected[reason]=(rejected[reason]||0)+1;
 return {v1:{trades:closed.length,netPnl:sum(closed),winRate:closed.length?wins.length/closed.length:null,averageWin:wins.length?sum(wins)/wins.length:null,averageLoss:losses.length?sum(losses)/losses.length:null},v2:{mode:'qualification-only',evaluated:shadowDecisions.length,qualified:shadowDecisions.filter(d=>d.qualified).length,rejected,netPnl:null,winRate:null},note:'Paper-v2 has no simulated executions yet. Do not compare returns until a separate fill journal is implemented.'};
}
