// Preparation only. No provider requests, credentials, or cross-network media.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { proofDeadline, proofCredentials, relayOnlySignal } from '../src/turn-experiment.ts';
import { relayProofConfiguration, relayProofRoute } from '../../src/StreamRoom.App/Web/turn-proof-ice.mjs';
import { directConfiguration } from '../../src/StreamRoom.App/Web/direct-ice.mjs';
const settings=()=>({TURN_EXPERIMENT:'true',TURN_TEST_EXPIRES_AT:new Date(Date.now()+600_000).toISOString(),TURN_TEST_ROOM_ID:crypto.randomUUID(),TURN_CREATE_KEY:'a'.repeat(64),TURN_KEY_ID:'b'.repeat(32),TURN_KEY_SECRET:'NEVER_RETURN_LONG_KEY'});
const answer={iceServers:[{urls:['stun:stun.cloudflare.com:3478']},{urls:['turn:turn.cloudflare.com:3478?transport=udp','turns:turn.cloudflare.com:443?transport=tcp','turn:turn.cloudflare.com:53?transport=udp','turn:foreign.test:3478'],username:'ephemeral-user',credential:'ephemeral-password'}]};
test('disabled, missing, expired or excessively long experiment cannot request TURN credentials',async()=>{
 let called=0;const request=async()=>{called++;return Response.json(answer);};
 for(const env of [{},{...settings(),TURN_EXPERIMENT:'false'},{...settings(),TURN_TEST_EXPIRES_AT:new Date(Date.now()-1).toISOString()},{...settings(),TURN_TEST_EXPIRES_AT:new Date(Date.now()+1_000_000).toISOString()}]){
  assert.throws(()=>proofDeadline(env));await assert.rejects(proofCredentials(env,Date.now()+180_000,request));
 }
 assert.equal(called,0);
});
test('provider key stays server-side; ephemeral, bounded, authenticated configuration is relay-only',async()=>{
 const env=settings(),expires=Date.now()+180_000;let ttl;
 const result=await proofCredentials(env,expires,async(url,options)=>{
  assert.match(url,/credentials\/generate-ice-servers$/);assert.equal(options.headers.Authorization,'Bearer '+env.TURN_KEY_SECRET);ttl=JSON.parse(options.body).ttl;
  return Response.json(answer,{status:201});
 });
 assert.ok(ttl<=180&&ttl>=175);assert.equal(JSON.stringify(result).includes(env.TURN_KEY_SECRET),false);assert.equal(result.iceServers[0].urls.length,2);
 assert.equal(relayProofConfiguration(result).iceTransportPolicy,'relay');
 assert.throws(()=>directConfiguration(result));
 assert.throws(()=>relayProofConfiguration({...result,policy:'direct-only'}));
 assert.throws(()=>relayProofConfiguration({...result,expiresAt:Date.now()+500_000}));
 assert.throws(()=>relayProofConfiguration({...result,expiresAt:Date.now()-1}));
 await assert.rejects(proofCredentials(env,expires,async()=>new Response('NEVER_RETURN_LONG_KEY',{status:403})),e=>!e.message.includes(env.TURN_KEY_SECRET));
});
test('selected local relay is required; peer-reflexive remote discovery does not lose proof of TURN',()=>{
 const reports=new Map([['t',{type:'transport',selectedCandidatePairId:'p'}],['p',{state:'succeeded',localCandidateId:'l',remoteCandidateId:'r'}],['l',{candidateType:'relay',protocol:'udp'}],['r',{candidateType:'relay'}]]);
 assert.equal(relayProofRoute(reports).turnConfirmed,true);assert.equal(relayProofRoute(new Map()).turnConfirmed,false);
 reports.get('r').candidateType='prflx';assert.equal(relayProofRoute(reports).turnConfirmed,true);
 reports.get('l').candidateType='host';assert.equal(relayProofRoute(reports).invalid,true);
 assert.equal(relayOnlySignal({kind:'ice',candidate:'candidate:1 1 udp 1 192.0.2.1 5000 typ relay'}),true);
 assert.equal(relayOnlySignal({kind:'ice',candidate:'candidate:1 1 udp 1 192.0.2.1 5000 typ host'}),false);
 assert.equal(relayOnlySignal({kind:'offer',sdp:'v=0\r\na=candidate:1 1 udp 1 192.0.2.1 5000 typ host\r\n'}),false);
});
const source=(await readFile(new URL('../dist/index.js',import.meta.url),'utf8')).replaceAll('"cloudflare:workers"',JSON.stringify('data:text/javascript,'+encodeURIComponent('export class DurableObject { constructor(ctx, env) { this.ctx=ctx;this.env=env; } }')));
const {MultiRoom,default:worker}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
globalThis.WebSocketRequestResponsePair=class {};
function context() {
 const data=new Map();let gate=Promise.resolve();
 const socket=role=>({value:{id:crypto.randomUUID(),role,name:role,lastSeen:Date.now(),window:Date.now(),count:0,...role==='host'?{streamId:crypto.randomUUID()}:{}},messages:[],deserializeAttachment(){return structuredClone(this.value);},serializeAttachment(v){this.value=structuredClone(v);},send(s){this.messages.push(JSON.parse(s));},close(){this.closed=true;}});
 const host=socket('host'),viewer=socket('viewer');
 const ctx={storage:{get:async key=>data.get(key),put:async(key,v)=>data.set(key,structuredClone(v)),delete:async key=>data.delete(key),deleteAll:async()=>data.clear(),setAlarm:async()=>{},deleteAlarm:async()=>{}},
  setWebSocketAutoResponse(){},getWebSockets:()=>[host,viewer],getWebSocketAutoResponseTimestamp:()=>new Date(),blockConcurrencyWhile(fn){const result=gate.then(fn);gate=result.catch(()=>{});return result;}};
 return {ctx,host,viewer,data,ready:()=>gate};
}
test('real bundled room limits provider issuance to two roles, survives hibernation and never revives after closing',async()=>{
 const env=settings(),c=context(),room=new MultiRoom(c.ctx,env);await c.ready();
 const metadata={roomId:env.TURN_TEST_ROOM_ID,inviteHash:'not-used',hostHash:'not-used',expiresAt:Date.now()+600_000};
 await room.initialize(metadata);
 const oldFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return Response.json(answer,{status:201});};
 try {
  await Promise.all([room.webSocketMessage(c.host,JSON.stringify({type:'ice_config'})),room.webSocketMessage(c.host,JSON.stringify({type:'ice_config'}))]);
  await room.webSocketMessage(c.viewer,JSON.stringify({type:'ice_config'}));
  assert.equal(requests,2);assert.equal(c.host.messages.filter(m=>m.type==='ice_servers').length,1);assert.equal(c.viewer.messages.filter(m=>m.type==='ice_servers').length,1);
  const deadline=c.data.get('room').expiresAt;assert.ok(deadline<=Date.now()+180_000);
  await room.webSocketMessage(c.host,JSON.stringify({type:'renew'}));assert.equal(c.data.get('room').expiresAt,deadline);
  const restored=new MultiRoom(c.ctx,env);await c.ready();await restored.webSocketMessage(c.host,JSON.stringify({type:'ice_config'}));assert.equal(requests,2);
  await restored.webSocketMessage(c.host,JSON.stringify({type:'leave'}));assert.equal(c.data.has('room'),false);assert.equal(c.data.get('proofUsed'),true);
  const closed=new MultiRoom(c.ctx,env);await c.ready();await assert.rejects(closed.initialize(metadata));
 } finally {globalThis.fetch=oldFetch;}
});
test('experimental HTTP creation requires a private key; stable health remains direct-only',async()=>{
 const env=settings();let used=false;env.CREATE_LIMITER={limit:async()=>{used=true;return {success:true};}};
 assert.equal((await worker.fetch(new Request('https://proof.test/v2/rooms',{method:'POST'}),env)).status,403);assert.equal(used,false);
 assert.equal((await worker.fetch(new Request('https://proof.test/health'),{...env,TURN_TEST_EXPIRES_AT:'DISABLED'})).status,200);
 assert.equal((await (await worker.fetch(new Request('https://proof.test/health'),{...env,TURN_EXPERIMENT:'false'})).json()).mediaPolicy,'direct-only');
});

test('bundled experimental signaling admits relay only for an authorized 720p30 subscription',async()=>{
 const env=settings(),c=context(),room=new MultiRoom(c.ctx,env);await c.ready();
 await room.initialize({roomId:env.TURN_TEST_ROOM_ID,inviteHash:'unused',hostHash:'unused',expiresAt:Date.now()+600_000});
 const subscriptionId=crypto.randomUUID(),session=crypto.randomUUID(),streamId=c.host.value.streamId;
 await room.webSocketMessage(c.viewer,JSON.stringify({type:'watch',publisherId:c.host.value.id,streamId,subscriptionId,active:true,height:720,fps:30}));
 const payload={kind:'ice',streamId,subscriptionId,session,candidate:'candidate:1 1 udp 1 192.0.2.1 5000 typ relay',sdpMid:'0',sdpMLineIndex:0};
 await room.webSocketMessage(c.host,JSON.stringify({type:'signal',to:c.viewer.value.id,payload}));
 assert.equal(c.viewer.messages.filter(m=>m.type==='signal').length,1);
 await room.webSocketMessage(c.host,JSON.stringify({type:'signal',to:c.viewer.value.id,payload:{...payload,candidate:payload.candidate.replace('typ relay','typ host')}}));
 assert.equal(c.viewer.messages.filter(m=>m.type==='signal').length,1);
 await room.webSocketMessage(c.viewer,JSON.stringify({type:'stream',active:true,streamId:crypto.randomUUID()}));assert.equal(c.viewer.messages.at(-1).code,'proof_role');
 await room.webSocketMessage(c.viewer,JSON.stringify({type:'watch',publisherId:c.host.value.id,streamId,subscriptionId,active:true,height:1080,fps:60}));assert.equal(c.viewer.messages.at(-1).code,'proof_quality');
});
