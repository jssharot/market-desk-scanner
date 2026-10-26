import {freshQuote,eastern} from './engine.mjs';
export const LAB_RULES=Object.freeze({maxPremium:250,maxOpenPremium:500,dailyLoss:250,weeklyLoss:750,fee:.65,slippage:.01});
export function qualify(c,r={},now=Date.now()){
 const reasons=[],home=c.strategy==='home_run',momentum=c.strategy==='momentum';
 if(!home&&!momentum)return {eligible:false,reasons:['unknown-strategy']};
 const q=c.quote,ask=q?.ap,bid=q?.bp,cost=(ask+LAB_RULES.slippage)*100+LAB_RULES.fee;
 if(!freshQuote(q,now))reasons.push('stale-option-quote');
 if(!Number.isFinite(cost)||cost<100||cost>LAB_RULES.maxPremium)reasons.push('premium-budget');
 if((r.openPremium||0)+cost>LAB_RULES.maxOpenPremium)reasons.push('aggregate-risk');
 if((r.dailyPnl||0)<=-LAB_RULES.dailyLoss||(r.weeklyPnl||0)<=-LAB_RULES.weeklyLoss)reasons.push('loss-cutoff');
 if((r.lossStreak||0)>=3)reasons.push('cooldown');
 if((r.openCount||0)>=2)reasons.push('strategy-open-limit');
 const spread=(ask-bid)/((ask+bid)/2);
 if(!Number.isFinite(spread)||spread>(home?.12:.08))reasons.push('spread');
 if((c.relativeVolume||0)<(home?2:1.5)||(c.optionVolume||0)<(home?200:500)||(c.openInterest||0)<(home?500:1000))reasons.push('liquidity');
 if(!Number.isFinite(c.delta)||Math.abs(c.delta)<(home?.1:.35)||Math.abs(c.delta)>(home?.35:.6))reasons.push('delta');
 if(!Number.isInteger(c.dte)||c.dte<(home?1:3)||c.dte>(home?10:14))reasons.push('expiration');
 if(home&&!c.catalystVerified)reasons.push('catalyst-unverified');
 if(momentum&&!c.technicalConfirmed)reasons.push('technical-unconfirmed');
 return {eligible:!reasons.length,reasons,cost};
}
export function openLab(c,now=Date.now()){return {id:c.id,strategy:c.strategy,symbol:c.symbol,contractSymbol:c.contractSymbol,side:c.side,status:'open',openedAt:new Date(now).toISOString(),entryPremium:c.quote.ap+LAB_RULES.slippage,entryFee:LAB_RULES.fee,markPremium:c.quote.bp,quoteTime:c.quote.t,catalyst:c.catalyst||null,fillModel:'ask + 0.01 / bid - 0.01, 0.65 each side',maxLoss:(c.quote.ap+LAB_RULES.slippage)*100+LAB_RULES.fee};}
export function exitLab(p,q,reason,now=Date.now()){if(!freshQuote(q,now))return {...p,pendingExit:reason};const exitPremium=Math.max(0,q.bp-LAB_RULES.slippage);return {...p,status:'closed',closedAt:new Date(now).toISOString(),exitPremium,exitQuoteTime:q.t,exitReason:reason,pendingExit:null,pnl:(exitPremium-p.entryPremium)*100-p.entryFee-LAB_RULES.fee};}
export function labExitReason(p,q,minutesToClose){if(minutesToClose<=5)return 'End of session';if(!freshQuote(q))return null;const change=(q.bp-p.entryPremium)/p.entryPremium;const home=p.strategy==='home_run';if(change<= (home?-.5:-.35))return 'Premium stop';if(change >= (home?1.5:.5))return 'Profit target';return null;}
export function labMetrics(journal){const closed=journal.filter(p=>p.status==='closed').sort((a,b)=>a.closedAt.localeCompare(b.closedAt)),wins=closed.filter(p=>p.pnl>0),losses=closed.filter(p=>p.pnl<0);let equity=0,peak=0,maxDrawdown=0;for(const p of closed){equity+=p.pnl;peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,peak-equity)}const sum=a=>a.reduce((s,p)=>s+p.pnl,0);return {closed:closed.length,open:journal.filter(p=>p.status==='open').length,pnl:sum(closed),winRate:closed.length?wins.length/closed.length:null,expectancy:closed.length?sum(closed)/closed.length:null,profitFactor:losses.length?sum(wins)/-sum(losses):null,maxDrawdown,averageWin:wins.length?sum(wins)/wins.length:null,averageLoss:losses.length?sum(losses)/losses.length:null};}
export function weekKey(t){const d=new Date(t),day=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-day);return d.toISOString().slice(0,10)}
export function riskState(journal,strategy,now=Date.now()){const today=eastern(now).date,week=weekKey(now),rows=journal.filter(p=>p.strategy===strategy),closed=rows.filter(p=>p.status==='closed').sort((a,b)=>a.closedAt.localeCompare(b.closedAt));let lossStreak=0;for(const p of [...closed].reverse()){if(p.pnl>=0)break;lossStreak++}return {openPremium:journal.filter(p=>p.status==='open').reduce((s,p)=>s+p.maxLoss,0),openCount:rows.filter(p=>p.status==='open').length,dailyPnl:closed.filter(p=>eastern(p.closedAt).date===today).reduce((s,p)=>s+p.pnl,0),weeklyPnl:closed.filter(p=>weekKey(p.closedAt)===week).reduce((s,p)=>s+p.pnl,0),lossStreak};}
