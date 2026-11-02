import {test} from 'node:test';import assert from 'node:assert/strict';
import {profileMessage,verifyProfile} from '../src/people-proof.ts';
const base=process.env.STREAMROOM_TEST_URL??'http://127.0.0.1:8787';
async function identity(){const key=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),spki=new Uint8Array(await crypto.subtle.exportKey('spki',key.publicKey));const h=Buffer.from(await crypto.subtle.digest('SHA-256',spki)).toString('hex').slice(0,32);return {key,id:`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`,publicKey:Buffer.from(spki).toString('base64')};}
async function sign(owner,fields={}){const p={id:owner.id,name:'Ámigo '+owner.id.slice(0,8),avatar:null,listed:true,at:Date.now(),publicKey:owner.publicKey,...fields};p.signature=Buffer.from(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},owner.key.privateKey,new TextEncoder().encode(profileMessage(p)))).toString('base64');return p;}
const publish=p=>fetch(base+'/v2/people',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});
test('public profile proof rejects forgery, stale requests and changed contents',async()=>{
 const a=await identity(),b=await identity(),p=await sign(a);assert.ok(await verifyProfile(p));
 for(const bad of [{...p,name:'Forjado'},{...p,id:b.id},{...p,listed:false},{...p,publicKey:b.publicKey},{...p,at:p.at-600000}])assert.equal(await verifyProfile(bad),null);
});
test('global lookup uses opt-in profiles outside rooms and only owners can change them',async()=>{
 const a=await identity(),p=await sign(a);assert.equal((await publish(p)).status,200);
 const search=async()=>{const r=await fetch(base+'/v2/people?q='+encodeURIComponent('amigo '+a.id.slice(0,8)));assert.equal(r.status,200);return (await r.json()).people;};
 const results=await search();assert.equal(results.length,1);assert.equal(results[0].id,a.id);assert.deepEqual(Object.keys(results[0]).sort(),['avatar','id','name']);
 assert.equal((await publish(p)).status,409);assert.equal((await publish({...p,name:'Intruso'})).status,401);
 await new Promise(r=>setTimeout(r,2));assert.equal((await publish(await sign(a,{listed:false}))).status,200);assert.deepEqual(await search(),[]);
 assert.equal((await publish(p)).status,409);
});
