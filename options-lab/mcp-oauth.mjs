import {randomBytes,createHash,createHmac,timingSafeEqual} from 'node:crypto';

const origin='https://options-lab-beta.onrender.com';
const pending=new Map(), codes=new Map();
const ACCESS_LIFETIME=3600, REFRESH_LIFETIME=30*24*3600;
const tokenKey=()=>process.env.OPTIONS_LAB_OAUTH_SIGNING_SECRET||process.env.GOOGLE_OAUTH_CLIENT_SECRET||'';
const signedToken=(kind,client_id,seconds)=>{const body=Buffer.from(JSON.stringify({kind,client_id,exp:Math.floor(Date.now()/1000)+seconds,nonce:random()})).toString('base64url');const signature=createHmac('sha256',tokenKey()).update(body).digest('base64url');return body+'.'+signature};
const verifyToken=(token,kind)=>{try{if(!tokenKey())return null;const parts=token.split('.');if(parts.length!==2)return null;const expected=createHmac('sha256',tokenKey()).update(parts[0]).digest();const provided=Buffer.from(parts[1],'base64url');if(provided.length!==expected.length||!timingSafeEqual(provided,expected))return null;const data=JSON.parse(Buffer.from(parts[0],'base64url').toString());return data.kind===kind&&Number.isSafeInteger(data.exp)&&data.exp>Math.floor(Date.now()/1000)&&typeof data.client_id==='string'&&getClient(data.client_id)?data:null}catch{return null}};
const sign=x=>createHmac('sha256',process.env.GOOGLE_OAUTH_CLIENT_SECRET||'').update(x).digest('base64url');
const registerClient=uris=>{const payload=Buffer.from(JSON.stringify({uris})).toString('base64url');return payload+'.'+sign(payload)};
const getClient=id=>{try{const [payload,signature,...rest]=id.split('.');if(rest.length||!payload||!signature||!process.env.GOOGLE_OAUTH_CLIENT_SECRET)return null;const a=Buffer.from(signature),b=Buffer.from(sign(payload));if(a.length!==b.length||!timingSafeEqual(a,b))return null;return JSON.parse(Buffer.from(payload,'base64url').toString())}catch{return null}};
const random=()=>randomBytes(32).toString('base64url');
const digest=x=>createHash('sha256').update(x).digest('base64url');
const reply=(res,status,obj,headers={})=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store',...headers});res.end(JSON.stringify(obj))};
const redirect=(res,url)=>{res.writeHead(302,{location:url,'cache-control':'no-store'});res.end()};
const validRedirect=url=>{try{const u=new URL(url);return u.protocol==='https:'||u.hostname==='localhost'&&u.protocol==='http:'}catch{return false}};
const prune=()=>{for(const m of [pending,codes])for(const [k,v] of m)if(v.expires<Date.now())m.delete(k)};
const googleConfigured=()=>!!(process.env.GOOGLE_OAUTH_CLIENT_ID&&process.env.GOOGLE_OAUTH_CLIENT_SECRET&&process.env.OPTIONS_LAB_GOOGLE_EMAIL);
const config={issuer:origin,authorization_endpoint:origin+'/oauth/authorize',token_endpoint:origin+'/oauth/token',registration_endpoint:origin+'/oauth/register',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],scopes_supported:['options.read']};
export function oauthTokenValid(header){
 const value=(header||'').match(/^Bearer (.+)$/)?.[1];if(!value)return false;
 return !!verifyToken(value,'access');
}
export async function handleOAuth(req,res,u){
 prune();
 if(u.pathname==='/.well-known/oauth-authorization-server'||u.pathname==='/.well-known/oauth-authorization-server/mcp')return reply(res,200,config);
 if(u.pathname==='/.well-known/oauth-protected-resource'||u.pathname==='/.well-known/oauth-protected-resource/mcp')return reply(res,200,{resource:origin+'/mcp',authorization_servers:[origin],scopes_supported:['options.read']});
 if(u.pathname==='/oauth/register'){
  if(req.method!=='POST')return reply(res,405,{error:'method_not_allowed'});
  let raw='';for await(const p of req){raw+=p;if(raw.length>8192)return reply(res,413,{error:'request_too_large'})}
  let data;try{data=JSON.parse(raw)}catch{return reply(res,400,{error:'invalid_client_metadata'})}
  if(!Array.isArray(data.redirect_uris)||data.redirect_uris.length<1||data.redirect_uris.length>5||!data.redirect_uris.every(validRedirect))return reply(res,400,{error:'invalid_redirect_uri'});
  if(!googleConfigured())return reply(res,503,{error:'google_oauth_not_configured'});
  const client_id=registerClient(data.redirect_uris);
  return reply(res,201,{client_id,redirect_uris:data.redirect_uris,token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']});
 }
 if(u.pathname==='/oauth/authorize'){
  if(req.method!=='GET')return reply(res,405,{error:'method_not_allowed'});
  if(!googleConfigured())return reply(res,503,{error:'google_oauth_not_configured'});
  const client_id=u.searchParams.get('client_id'),redirect_uri=u.searchParams.get('redirect_uri'),challenge=u.searchParams.get('code_challenge'),state=u.searchParams.get('state');
  if(!getClient(client_id)?.uris.includes(redirect_uri)||u.searchParams.get('response_type')!=='code'||u.searchParams.get('code_challenge_method')!=='S256'||!challenge||!state)return reply(res,400,{error:'invalid_request'});
  const nonce=random(),googleState=random();
  pending.set(googleState,{client_id,redirect_uri,challenge,state,nonce,expires:Date.now()+300000});
  const q=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  for(const [k,v] of Object.entries({client_id:process.env.GOOGLE_OAUTH_CLIENT_ID,redirect_uri:origin+'/auth/google/callback',response_type:'code',scope:'openid email',state:googleState,nonce,prompt:'select_account'}))q.searchParams.set(k,v);
  return redirect(res,q.toString());
 }
 if(u.pathname==='/auth/google/callback'){
  if(req.method!=='GET')return reply(res,405,{error:'method_not_allowed'});
  const s=u.searchParams.get('state'),p=pending.get(s);pending.delete(s);
  if(!p||p.expires<Date.now())return reply(res,400,{error:'expired_state'});
  if(u.searchParams.has('error'))return reply(res,400,{error:'google_authorization_denied'});
  const code=u.searchParams.get('code');if(!code)return reply(res,400,{error:'missing_code'});
  try{
   const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:process.env.GOOGLE_OAUTH_CLIENT_ID,client_secret:process.env.GOOGLE_OAUTH_CLIENT_SECRET,redirect_uri:origin+'/auth/google/callback',grant_type:'authorization_code'})});
   if(!response.ok)throw Error('Google token exchange failed');
   const google=await response.json();
   const verify=await fetch('https://oauth2.googleapis.com/tokeninfo?id_token='+encodeURIComponent(google.id_token));
   if(!verify.ok)throw Error('Google ID token verification failed');
   const identity=await verify.json();
   if(identity.aud!==process.env.GOOGLE_OAUTH_CLIENT_ID||identity.nonce!==p.nonce||identity.email_verified!=='true'||identity.email?.toLowerCase()!==process.env.OPTIONS_LAB_GOOGLE_EMAIL.toLowerCase())throw Error('Google identity not authorized');
   const authCode=random();codes.set(digest(authCode),{...p,expires:Date.now()+120000});
   const dest=new URL(p.redirect_uri);dest.searchParams.set('code',authCode);dest.searchParams.set('state',p.state);return redirect(res,dest.toString());
  }catch(e){return reply(res,403,{error:'access_denied',error_description:e.message})}
 }
 if(u.pathname==='/oauth/token'){
  if(req.method!=='POST')return reply(res,405,{error:'method_not_allowed'});
  let raw='';for await(const p of req){raw+=p;if(raw.length>8192)return reply(res,413,{error:'request_too_large'})}
  const body=new URLSearchParams(raw);
  if(body.get('grant_type')==='refresh_token'){
   const client_id=body.get('client_id')||'';
   const record=verifyToken(body.get('refresh_token')||'','refresh');
   if(!record||record.client_id!==client_id)return reply(res,400,{error:'invalid_grant'});
   return reply(res,200,{access_token:signedToken('access',client_id,ACCESS_LIFETIME),refresh_token:signedToken('refresh',client_id,REFRESH_LIFETIME),token_type:'Bearer',expires_in:ACCESS_LIFETIME,scope:'options.read'});
  }
  const authCode=body.get('code'),record=codes.get(digest(authCode||''));
  codes.delete(digest(authCode||''));
  if(body.get('grant_type')!=='authorization_code'||!record||record.expires<Date.now()||body.get('client_id')!==record.client_id||body.get('redirect_uri')!==record.redirect_uri||digest(body.get('code_verifier')||'')!==record.challenge)return reply(res,400,{error:'invalid_grant'});
  const client_id=record.client_id;
  return reply(res,200,{access_token:signedToken('access',client_id,ACCESS_LIFETIME),refresh_token:signedToken('refresh',client_id,REFRESH_LIFETIME),token_type:'Bearer',expires_in:ACCESS_LIFETIME,scope:'options.read'});
 }
 return false;
}
