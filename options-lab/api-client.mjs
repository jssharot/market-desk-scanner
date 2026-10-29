// Read-only client for the existing authenticated Market Desk backend.
// All secrets remain server-side; callers must provide an access token from secure server storage.
export class OptionsLabClient {
  constructor({baseUrl,token,fetchImpl=fetch}) {
    const u=new URL(baseUrl);
    if(u.protocol!=='https:') throw Error('HTTPS required');
    if(!token) throw Error('Access token required');
    this.baseUrl=u.origin;
    this.token=token;
    this.fetchImpl=fetchImpl;
  }
  async get(path,params={}) {
    const url=new URL(path,this.baseUrl);
    if(url.origin!==this.baseUrl) throw Error('Cross-origin request blocked');
    for(const [key,value] of Object.entries(params)) if(value!==undefined&&value!==null) url.searchParams.set(key,String(value));
    const response=await this.fetchImpl(url,{method:'GET',headers:{Authorization:'Bearer '+this.token,Accept:'application/json'},signal:AbortSignal.timeout(12000)});
    if(!response.ok) throw Error('Market Desk request failed ('+response.status+')');
    return response.json();
  }
  expirations(symbol){return this.get('/market/options/expirations',{symbol});}
  chain(symbol,expiry,side){return this.get('/market/options/chain',{symbol,expiry,side});}
  contract(symbol,expiry,strike,side){return this.get('/options/contract',{symbol,expiry,strike,side});}
}
