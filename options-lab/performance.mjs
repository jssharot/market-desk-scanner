export function performanceMetrics(rows){
 const valid=rows.filter(x=>Number.isFinite(x.entry)&&x.entry>0);
 const closed=valid.filter(x=>Number.isFinite(x.exit)&&x.exit>=0);
 const open=valid.length-closed.length;
 const returns=closed.map(x=>(x.exit-x.entry)*100);
 const net=returns.reduce((a,b)=>a+b,0);
 const grossProfit=returns.reduce((a,b)=>a+Math.max(0,b),0);
 const grossLoss=returns.reduce((a,b)=>a+Math.max(0,-b),0);
 const wins=returns.filter(x=>x>0).length;
 const tiers={};
 for(const x of closed){
  const tier=x.setupTier||'Unrated';
  const row=tiers[tier]??={closed:0,wins:0,pnl:0};
  row.closed++;row.wins+=Number(x.exit>x.entry);row.pnl+=(x.exit-x.entry)*100;
 }
 const groupBy=key=>{const out={};for(const x of closed){const name=String(key(x)||'Unknown');const item=out[name]??={closed:0,wins:0,pnl:0};item.closed++;item.wins+=Number(x.exit>x.entry);item.pnl+=(x.exit-x.entry)*100;}return out};
 const averageWin=wins?grossProfit/wins:null;
 const averageLoss=closed.length>wins?-grossLoss/(closed.length-wins):null;
 return {averageWin,averageLoss,byTicker:groupBy(x=>x.symbol),byExitReason:groupBy(x=>x.exitReason),bySide:groupBy(x=>x.side),byHourET:groupBy(x=>{const d=new Date(x.createdAt);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',hourCycle:'h23'}).format(d)+':00':'Unknown'}),tracked:valid.length,open,closed:closed.length,wins,winRate:closed.length?wins/closed.length:null,netPnl:net,averagePnl:closed.length?net/closed.length:null,profitFactor:grossLoss?grossProfit/grossLoss:null,tiers};
}
