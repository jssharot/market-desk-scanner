// A restricted AI tool dispatcher. It cannot write trades or place orders.
import {screenContract} from './risk.mjs';
const SYMBOL=/^[A-Z]{1,5}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
function validateSymbol(symbol){if(typeof symbol!=='string'||!SYMBOL.test(symbol))throw Error('Invalid ticker');return symbol;}
export async function callAssistantTool(client,name,args={}) {
  switch(name){
    case 'get_expirations':
      return client.expirations(validateSymbol(args.symbol));
    case 'get_options_chain':
      if(!DATE.test(args.expiry)||!['call','put'].includes(args.side))throw Error('Invalid chain parameters');
      return client.chain(validateSymbol(args.symbol),args.expiry,args.side);
    case 'get_contract_quote': {
      const symbol=validateSymbol(args.symbol);
      if(!DATE.test(args.expiry)||!Number.isFinite(args.strike)||args.strike<=0||!['call','put'].includes(args.side))throw Error('Invalid contract parameters');
      return client.contract(symbol,args.expiry,args.strike,args.side);
    }
    case 'screen_contract':
      return screenContract(args.contract,{now:Date.now()});
    default: throw Error('Unsupported assistant tool');
  }
}
export const assistantPolicy = [
  'Use tools for current prices; never invent quotes, positions or trade fills.',
  'State quote timestamp and warn when stale or unavailable.',
  'Distinguish screening eligibility from a validated trade signal.',
  'No order execution or account modification tools are available.',
  'Do not claim access to brokerage holdings without verified synchronization.'
].join(' ');
