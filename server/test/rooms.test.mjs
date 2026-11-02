import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
const base = process.env.STREAMROOM_TEST_URL ?? 'http://127.0.0.1:8787';
const uuid = () => crypto.randomUUID();
async function createRoom() { const r=await fetch(base+'/v2/rooms',{method:'POST'}); assert.equal(r.status,201); return r.json(); }
function socket(roomId, route = "v2") {
  const ws=new WebSocket(base.replace(/^http/,'ws')+'/' + route + '/rooms/'+roomId+'/socket'), messages=[];
  ws.addEventListener('message',e=>messages.push(JSON.parse(e.data)));
  const opened=new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  return {ws,opened,messages,send(value){ws.send(JSON.stringify(value));},async wait(type,predicate=()=>true){
    const deadline=Date.now()+8000;while(Date.now()<deadline){const i=messages.findIndex(m=>m.type===type&&predicate(m));if(i!==-1)return messages.splice(i,1)[0];await delay(10);}throw Error('Timed out: '+type);
  },async join(token,displayName='Jogador',protocol=2){await opened;this.send({type:'join',token,displayName,protocol});return this.wait('welcome');}};
}
test('salas e múltiplas publicações reais no workerd',async t=>{
  const sockets=[];const connect=id=>{const c=socket(id);sockets.push(c);return c;};
  t.after(()=>{for(const c of sockets)c.ws.close();});
  const room=await createRoom(),host=connect(room.roomId),h=await host.join(room.hostToken,'Criador');
  await t.test('protocolo 2, TTL 24h, health e rotas',async()=>{
    assert.equal(room.protocol,2);assert.ok(room.expiresAt-Date.now()>86_300_000);
    const health=await(await fetch(base+'/health')).json();assert.equal(health.protocol,2);
    assert.equal((await fetch(base+'/v2/rooms')).status,404);
    assert.equal((await fetch(base+'/v2/rooms/'+room.roomId+'/socket')).status,426);
    host.send({type:'renew'});assert.equal((await host.wait('room_renewed')).expiresAt,room.expiresAt);
  });
  await t.test('clientes antigos recebem erro de atualização',async()=>{
    const bad=connect(room.roomId);await bad.opened;bad.send({type:'join',token:room.inviteToken,displayName:'Antigo',protocol:1});
    assert.equal((await bad.wait('error')).code,'protocol_mismatch');
  });
  await t.test('autenticação, nome e criador duplicado recusados',async()=>{
    for(const [token,name,code] of [['0'.repeat(64),'Intruso','unauthorized'],[room.inviteToken,'x'.repeat(33),'invalid_join'],[room.hostToken,'Duplicado','room_full']]){
      const c=connect(room.roomId);await c.opened;c.send({type:'join',token,displayName:name,protocol:2});assert.equal((await c.wait('error')).code,code);
    }
  });
  const guests=[0,1,2,3].map(()=>connect(room.roomId));
  const welcomes=await Promise.all(guests.map((c,i)=>c.join(room.inviteToken,'Amigo '+i)));
  const clients=[host,...guests], ids=[h.participantId,...welcomes.map(w=>w.participantId)], streams=ids.map(uuid);
  await t.test('cinco participantes; sexto recusado',async()=>{
    assert.equal((await host.wait('room',m=>m.participants.length===5)).participants.length,5);
    const c=connect(room.roomId);await c.opened;c.send({type:'join',token:room.inviteToken,displayName:'Sexto',protocol:2});assert.equal((await c.wait('error')).code,'room_full');
  });
  await t.test('todos publicam suas próprias transmissões simultaneamente',async()=>{
    for(let i=0;i<5;i++)clients[i].send({type:'stream',active:true,streamId:streams[i]});
    const state=await host.wait('room',m=>m.participants.filter(p=>p.streaming).length===5);
    assert.equal(new Set(state.participants.map(p=>p.streamId)).size,5);assert.deepEqual(state.subscribers,[]);assert.deepEqual(state.subscriptions,[]);
  });
  const subAB=uuid(),subBA=uuid(),subBC=uuid(),subCB=uuid();
  function watch(i,j,sub,active=true,height=480,fps=30){clients[i].send({type:'watch',publisherId:ids[j],streamId:streams[j],subscriptionId:sub,active,height,fps});}
  function signal(i,j,sub,stream,kind,more={}){clients[i].send({type:'signal',to:ids[j],from:'forged',payload:{kind,streamId:streams[stream],subscriptionId:sub,session:'12345678-1234-1234-1234-123456789abc',...more}});}
  await t.test('ninguém recebe ofertas sem escolher assistir',async()=>{
    signal(0,1,uuid(),0,'offer',{sdp:'v=0'});assert.equal((await host.wait('error')).code,'not_subscribed');
  });
  await t.test('assinaturas cruzadas entre criador e amigo e entre dois amigos',async()=>{
    watch(0,1,subAB);watch(1,0,subBA);watch(1,2,subBC);watch(2,1,subCB);
    const b=await guests[0].wait('room',m=>m.subscribers.length===2&&m.subscriptions.length===2);
    assert.deepEqual(new Set(b.subscribers.map(s=>s.viewerId)),new Set([ids[0],ids[2]]));
    const d=await guests[2].wait('room',m=>m.participants.filter(p=>p.streaming).length===5&&m.subscribers.length===0);
    assert.deepEqual(d.subscriptions,[]); // Untouched participant has no media subscriptions.
  });
  await t.test('ofertas, respostas e ICE são dirigidos pela transmissão, não pelo papel',async()=>{
    for(const [publisher,viewer,sub] of [[1,0,subAB],[0,1,subBA],[2,1,subBC],[1,2,subCB]]){
      signal(publisher,viewer,sub,publisher,'offer',{sdp:'v=0'});
      const offer=await clients[viewer].wait('signal',m=>m.payload.subscriptionId===sub);assert.equal(offer.from,ids[publisher]);assert.equal(offer.payload.streamId,streams[publisher]);
      signal(viewer,publisher,sub,publisher,'answer',{sdp:'v=0'});
      assert.equal((await clients[publisher].wait('signal',m=>m.payload.subscriptionId===sub)).payload.kind,'answer');
      signal(viewer,publisher,sub,publisher,'ice',{candidate:'candidate:test',sdpMid:'0',sdpMLineIndex:0});
      assert.equal((await clients[publisher].wait('signal',m=>m.payload.subscriptionId===sub)).payload.kind,'ice');
    }
  });
  await t.test('isolamento de direção, transmissão e identificadores',async()=>{
    signal(0,1,subAB,1,'offer',{sdp:'bad'});assert.equal((await host.wait('error')).code,'invalid_signal');
    signal(1,3,subAB,1,'offer',{sdp:'bad'});assert.equal((await guests[0].wait('error')).code,'not_subscribed');
    guests[0].send({type:'stream',active:true,streamId:streams[0]});assert.equal((await guests[0].wait('error')).code,'duplicate_stream');
    watch(3,0,subAB);assert.equal((await guests[2].wait('error')).code,'duplicate_subscription');
    guests[0].send({type:'renew'});assert.equal((await guests[0].wait('error')).code,'forbidden');
  });
  await t.test('qualidade individual não altera a de outro espectador',async()=>{
    watch(0,1,subAB,true,1080,60);
    const b=await guests[0].wait('room',m=>m.subscribers.some(s=>s.subscriptionId===subAB&&s.height===1080));
    assert.equal(b.subscribers.find(s=>s.subscriptionId===subCB).height,480);
    watch(0,1,subAB,true,4000,120);assert.equal((await host.wait('error')).code,'invalid_quality');
  });
  await t.test('TURN e relay continuam bloqueados',async()=>{
    host.send({type:'ice_config'});const ice=await host.wait('ice_servers');
    assert.equal(ice.turnAvailable,false);assert.ok(ice.iceServers.every(s=>!s.credential&&s.urls.every(u=>u.startsWith('stun:'))));
    signal(1,0,subAB,1,'ice',{candidate:'candidate:1 1 UDP 1 192.0.2.1 1 typ relay',sdpMid:'0',sdpMLineIndex:0});assert.equal((await guests[0].wait('error')).code,'relay_disabled');
    signal(1,0,subAB,1,'offer',{sdp:'v=0\r\na=candidate:1 1 UDP 1 192.0.2.1 1 typ relay\r\n'});assert.equal((await guests[0].wait('error')).code,'relay_disabled');
  });
  await t.test('desassinar uma gameplay mantém as demais assinaturas',async()=>{
    for(const c of clients)c.messages.length=0;
    watch(1,2,subBC,false);
    const b=await guests[0].wait('room',m=>m.subscriptions.length===1&&m.subscriptions[0].subscriptionId===subBA);
    assert.equal(b.subscribers.length,2);
    signal(2,1,subBC,2,'offer',{sdp:'late'});assert.equal((await guests[1].wait('error')).code,'not_subscribed');
  });
  await t.test('parar a própria transmissão preserva recepção e gameplays alheias',async()=>{
    for(const c of clients)c.messages.length=0;
    guests[0].send({type:'stream',active:false,streamId:streams[1]});
    const b=await guests[0].wait('room',m=>m.participants.find(p=>p.id===ids[1]).streamId===null);
    assert.equal(b.participants.filter(p=>p.streaming).length,4);assert.equal(b.subscribers.length,0);assert.equal(b.subscriptions[0].subscriptionId,subBA);
    const a=await host.wait('room',m=>m.participants.find(p=>p.id===ids[1]).streamId===null);
    assert.equal(a.subscriptions.length,0);assert.equal(a.subscribers[0].subscriptionId,subBA);
  });
  await t.test('reinício não restaura espectadores silenciosamente e stop antigo é ignorado',async()=>{
    const old=streams[1];streams[1]=uuid();guests[0].send({type:'stream',active:true,streamId:streams[1]});
    const b=await guests[0].wait('room',m=>m.participants.find(p=>p.id===ids[1]).streamId===streams[1]);assert.equal(b.subscribers.length,0);
    guests[0].send({type:'stream',active:false,streamId:old});guests[0].send({type:'ice_config'});await guests[0].wait('ice_servers');
    const sub=uuid();watch(0,1,sub);assert.equal((await host.wait('room',m=>m.subscriptions.some(s=>s.subscriptionId===sub))).participants.filter(p=>p.streaming).length,5);
  });
  await t.test('JSON inválido, ping e saída de amigo não derrubam outras streams',async()=>{
    guests[1].ws.send('{');assert.equal((await guests[1].wait('error')).code,'invalid_json');
    guests[1].send({type:'ping'});await guests[1].wait('pong');
    for(const c of clients)c.messages.length=0;
    guests[1].send({type:'leave'});
    const a=await host.wait('room',m=>m.participants.length===4);assert.equal(a.participants.filter(p=>p.streaming).length,4);
  });
  await t.test('criador ainda encerra a sala e invalida convites',async()=>{
    host.send({type:'leave'});await guests[0].wait('room_closed');const closed=connect(room.roomId);await assert.rejects(closed.opened);
  });
});

test("rota v1 preserva o beta anterior sem TURN", async () => { const r=await fetch(base+"/v1/rooms",{method:"POST"}); assert.equal(r.status,201); const room=await r.json(); assert.equal(room.protocol,1); const client=socket(room.roomId,"v1"); try { const welcome=await client.join(room.hostToken); assert.equal(welcome.protocol,1); client.send({type:"ice_config"}); assert.equal((await client.wait("ice_servers")).turnAvailable,false); client.send({type:"leave"}); await client.wait("room_closed"); } finally { client.ws.close(); } });
