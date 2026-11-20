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
