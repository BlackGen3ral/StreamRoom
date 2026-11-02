import { test } from 'node:test';
import assert from 'node:assert/strict';
import { googleExchange, validExchange } from '../src/google-oauth.ts';
import { clientConfig } from '../src/client-config.ts';
const env = { GOOGLE_CLIENT_ID:'123-test.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET:'synthetic-secret', CREATE_LIMITER:{ async limit(){return {success:true};} } };
const input = {client_id:env.GOOGLE_CLIENT_ID,code:'synthetic-code',code_verifier:'x'.repeat(43),redirect_uri:'http://127.0.0.1:49152/oauth2/callback',grant_type:'authorization_code'};
const request = (value=input, headers={}) => new Request('https://example.com/v2/google/exchange',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(value)});
test('exchange only sends credentials to Google and returns the ID token alone',async()=>{
  let calls=0;
  const result=await googleExchange(request(),env,async(url,options)=>{
    calls++;assert.equal(url,'https://oauth2.googleapis.com/token');assert.equal(options.redirect,'manual');
    const form=new URLSearchParams(options.body);assert.equal(form.get('client_secret'),'synthetic-secret');assert.equal(form.get('code_verifier'),input.code_verifier);
    return Response.json({id_token:'synthetic-id-token',access_token:'private-access',refresh_token:'private-refresh'});
  });
  assert.deepEqual(await result.json(),{id_token:'synthetic-id-token'});assert.equal(calls,1);
  assert.equal(result.headers.get('Cache-Control'),'no-store');
  assert.equal(clientConfig(env).googleTokenExchangeReady,true);assert.equal(JSON.stringify(clientConfig(env)).includes('synthetic-secret'),false);
});
test('exchange rejects remote redirects, wrong client, oversized input and browser origins before upstream',async()=>{
  for(const value of [{...input,redirect_uri:'https://malicious.example/callback'},{...input,client_id:'other'},{...input,code_verifier:'short'},{...input,redirect_uri:'http://127.0.0.1:65536/oauth2/callback'},{...input,code:'x'.repeat(9000)}]) {
    assert.equal(validExchange(value,env.GOOGLE_CLIENT_ID),false);
    assert.equal((await googleExchange(request(value),env,()=>{throw Error('must not call');})).status,400);
  }
  assert.equal((await googleExchange(request(input,{Origin:'https://malicious.example'}),env)).status,400);
  assert.equal((await googleExchange(request(),{...env,GOOGLE_CLIENT_SECRET:undefined})).status,503);
  assert.equal((await googleExchange(request(),{...env,CREATE_LIMITER:{async limit(){return {success:false};}}})).status,429);
});
test('provider errors never leak descriptions, credentials or tokens',async()=>{
  const result=await googleExchange(request(),env,async()=>Response.json({error:'invalid_grant',error_description:'synthetic-secret',access_token:'private'},{status:400}));
  assert.deepEqual(await result.json(),{error:'invalid_grant'});
  assert.equal((await googleExchange(request(),env,async()=>new Response('x'.repeat(40000)))).status,502);
});
