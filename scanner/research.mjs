import {eastern} from './engine.mjs';
export function reviewPricePath({side,stop,target,entryLow,entryHigh,start,expiry,bars,complete=true,now=Date.now()}){
 const firstMinute=Math.ceil(Date.parse(start)/60000)*60000;
 const rows=bars.filter(b=>Date.parse(b.t)>=firstMinute&&Date.parse(b.t)+60000<=now&&eastern(b.t).date<=expiry&&eastern(b.t).minute>=570&&eastern(b.t).minute<960&&[b.h,b.l,b.c].every(Number.isFinite)).sort((a,b)=>Date.parse(a.t)-Date.parse(b.t));
 let stopBar=null,targetBar=null;
 for(const b of rows){if(!stopBar&&(side==='call'?b.l<=stop:b.h>=stop))stopBar=b;if(target>0&&!targetBar&&(side==='call'?b.h>=target:b.l<=target))targetBar=b;}
 const last=rows.at(-1),ambiguous=stopBar&&targetBar&&stopBar.t===targetBar.t,targetFirst=targetBar&&(!stopBar||Date.parse(targetBar.t)<Date.parse(stopBar.t));
 let status='unresolved',label='Not enough price history';
 if(!complete){status='incomplete';label='Incomplete price history — outcome unverified'}
 else if(ambiguous){status='ambiguous';label='Stop and target crossed in the same minute — order unknown'}
 else if(stopBar&&!targetFirst){status='invalidated';label=side==='call'?'Invalidated: stock crossed below stop':'Invalidated: stock crossed above stop'}
 else if(targetFirst){status='target-observed';label=stopBar?'Target crossed before later stop breach':'First target crossed'}
 else if(last){status='no-breach';label='No stop or first-target crossing observed'}
 return {status,label,side,stop,target:target||null,stopEvidence:stopBar?{barTime:stopBar.t,low:stopBar.l,high:stopBar.h}:null,targetEvidence:targetBar?{barTime:targetBar.t,low:targetBar.l,high:targetBar.h}:null,lastPrice:last?.c??null,lastBarTime:last?.t??null,entryPosition:last&&entryLow>0&&entryHigh>=entryLow?(last.c>entryHigh?'above-entry-range':last.c<entryLow?'below-entry-range':'inside-entry-range'):null,barsReviewed:rows.length,complete,checkedAt:new Date(now).toISOString(),source:'Alpaca SIP one-minute regular-session stock bars',note:'Stock setup review, not actual trade performance. The partial alert minute is excluded. A bar crossing cannot prove a fill, precise crossing price, or option P/L. Entry-range movement alone is not a failed trade.'};
}
