import test from 'node:test';
import assert from 'node:assert/strict';
import {handleOAuth} from './mcp-oauth.mjs';
import {Readable} from 'node:stream';

const request=(path,body,method='POST')=>Object.assign(Readable.from([body]),{method});
const response=()=>({status:0,headers:{},body:'',writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=body}});
test('OAuth metadata advertises refresh-token grant',async()=>{
 const res=response();
 await handleOAuth({method:'GET'},res,new URL('https://options-lab-beta.onrender.com/.well-known/oauth-authorization-server'));
 assert.equal(res.status,200);
 assert.ok(JSON.parse(res.body).grant_types_supported.includes('refresh_token'));
});
test('invalid refresh token cannot be exchanged',async()=>{
 const res=response();
 await handleOAuth(request('/oauth/token',new URLSearchParams({grant_type:'refresh_token',client_id:'unknown',refresh_token:'forged'}).toString()),res,new URL('https://options-lab-beta.onrender.com/oauth/token'));
 assert.equal(res.status,400);
 assert.equal(JSON.parse(res.body).error,'invalid_grant');
});

test('OAuth authorization, refresh and token verification survive module reload',async()=>{
 const old={id:process.env.GOOGLE_OAUTH_CLIENT_ID,secret:process.env.GOOGLE_OAUTH_CLIENT_SECRET,email:process.env.OPTIONS_LAB_GOOGLE_EMAIL};
 const originalFetch=globalThis.fetch;
 process.env.GOOGLE_OAUTH_CLIENT_ID='test-google-client';
 process.env.GOOGLE_OAUTH_CLIENT_SECRET='test-signing-secret';
 process.env.OPTIONS_LAB_GOOGLE_EMAIL='owner@example.com';
 try{
  const {oauthTokenValid}=await import('./mcp-oauth.mjs');
  const call=async(path,body,method='POST')=>{const res=response();await handleOAuth(method==='GET'?{method}:request(path,body,method),res,new URL(path,'https://options-lab-beta.onrender.com'));return res};
  const reg=await call('/oauth/register',JSON.stringify({redirect_uris:['https://client.example/callback']}));
  assert.equal(reg.status,201);
  const client_id=JSON.parse(reg.body).client_id;
  const verifier='a'.repeat(50);
  const {createHash}=await import('node:crypto');
  const challenge=createHash('sha256').update(verifier).digest('base64url');
  const authorize=new URL('/oauth/authorize','https://options-lab-beta.onrender.com');
  for(const [key,value] of Object.entries({client_id,redirect_uri:'https://client.example/callback',response_type:'code',code_challenge_method:'S256',code_challenge:challenge,state:'client-state'}))authorize.searchParams.set(key,value);
  const start=response();
  await handleOAuth({method:'GET'},start,authorize);
  assert.equal(start.status,302);
  const google=new URL(start.headers.location);
  const nonce=google.searchParams.get('nonce');
  const callback=new URL('/auth/google/callback','https://options-lab-beta.onrender.com');
  callback.searchParams.set('state',google.searchParams.get('state'));
  callback.searchParams.set('code','fake-google-code');
  globalThis.fetch=async url=>({ok:true,json:async()=>String(url).includes('/tokeninfo')?{aud:'test-google-client',nonce,email_verified:'true',email:'owner@example.com'}:{id_token:'fake-id-token'}});
  const approved=response();
  await handleOAuth({method:'GET'},approved,callback);
  assert.equal(approved.status,302);
  const code=new URL(approved.headers.location).searchParams.get('code');
  const token=await call('/oauth/token',new URLSearchParams({grant_type:'authorization_code',client_id,redirect_uri:'https://client.example/callback',code,code_verifier:verifier}).toString());
  assert.equal(token.status,200);
  const first=JSON.parse(token.body);
  assert.ok(first.refresh_token);
  assert.ok(oauthTokenValid('Bearer '+first.access_token));
  const refresh=await call('/oauth/token',new URLSearchParams({grant_type:'refresh_token',client_id,refresh_token:first.refresh_token}).toString());
  assert.equal(refresh.status,200);
  const second=JSON.parse(refresh.body);
  assert.ok(oauthTokenValid('Bearer '+second.access_token));
  const otherClient=JSON.parse((await call('/oauth/register',JSON.stringify({redirect_uris:['https://other.example/callback']}))).body).client_id;
  const wrongClient=await call('/oauth/token',new URLSearchParams({grant_type:'refresh_token',client_id:otherClient,refresh_token:first.refresh_token}).toString());
  assert.equal(wrongClient.status,400);
  const future=Date.now;
  try { Date.now=()=>future()+31*24*3600*1000;
    assert.equal(oauthTokenValid('Bearer '+second.access_token),false);
    const expired=await call('/oauth/token',new URLSearchParams({grant_type:'refresh_token',client_id,refresh_token:second.refresh_token}).toString());
    assert.equal(expired.status,400);
  } finally { Date.now=future; }
  assert.equal(oauthTokenValid('Bearer '+second.refresh_token),false);
  const reloaded=await import('./mcp-oauth.mjs?restart-test='+Date.now());
  assert.ok(reloaded.oauthTokenValid('Bearer '+second.access_token));
  const tampered=second.access_token.slice(0,-2)+'xx';
  assert.equal(reloaded.oauthTokenValid('Bearer '+tampered),false);
 }finally{
  globalThis.fetch=originalFetch;
  for(const [key,value] of Object.entries({GOOGLE_OAUTH_CLIENT_ID:old.id,GOOGLE_OAUTH_CLIENT_SECRET:old.secret,OPTIONS_LAB_GOOGLE_EMAIL:old.email})){if(value===undefined)delete process.env[key];else process.env[key]=value}
 }
});
