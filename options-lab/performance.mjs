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
 return {tracked:valid.length,open,closed:closed.length,wins,winRate:closed.length?wins/closed.length:null,netPnl:net,averagePnl:closed.length?net/closed.length:null,profitFactor:grossLoss?grossProfit/grossLoss:null,tiers};
}
