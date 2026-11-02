import { directConfiguration, directRoute } from './direct-ice.mjs';
const pending=new Map(),endpoints=new Map(),states=new Map(),peers=[],checks=[];let sequence=0,queue=Promise.resolve();
function native(type,payload={}) {return new Promise((resolve,reject)=>{const id=String(++sequence),timer=setTimeout(()=>{pending.delete(id);reject(Error('Native timeout: '+type));},30000);pending.set(id,{resolve,reject,timer});window.chrome.webview.postMessage({id,type,payload});});}
window.chrome.webview.addEventListener('message',({data})=>{
  if(data.type==='reply'){const p=pending.get(data.id);if(!p)return;clearTimeout(p.timer);pending.delete(data.id);data.ok?p.resolve(data.result):p.reject(Error(data.error));}
  else if(data.type==='testRoomState')states.set(data.side,data.state);
  else if(data.type==='testSignal')queue=queue.then(async()=>{
    const p=data.payload,e=endpoints.get(data.side+':'+p.subscriptionId);if(!e||e.session!==p.session)return;
    if(p.kind==='offer'){await e.pc.setRemoteDescription({type:'offer',sdp:p.sdp});await e.pc.setLocalDescription(await e.pc.createAnswer());await e.send({kind:'answer',sdp:e.pc.localDescription.sdp});e.sent=true;for(const ice of e.local.splice(0))await e.send(ice);}
    else if(p.kind==='answer'){await e.pc.setRemoteDescription({type:'answer',sdp:p.sdp});for(const c of e.remote.splice(0))await e.pc.addIceCandidate(c);}
    else if(p.kind==='ice'){const c={candidate:p.candidate,sdpMid:p.sdpMid,sdpMLineIndex:p.sdpMLineIndex};if(e.pc.remoteDescription)await e.pc.addIceCandidate(c);else e.remote.push(c);}
  }).catch(e=>checks.push({test:'signaling',passed:false,error:e.message}));
});
async function wait(predicate){const end=Date.now()+12000;while(!predicate()){if(Date.now()>end)throw Error('Snapshot timeout');await new Promise(r=>setTimeout(r,30));}}
function endpoint(side,to,context,iceServers){
  const pc=new RTCPeerConnection(directConfiguration({iceServers}));peers.push(pc);
  const e={pc,session:context.session,sent:false,local:[],remote:[],send:p=>native('testSignal',{side,to,payload:{...p,...context}})};
  endpoints.set(side+':'+context.subscriptionId,e);
  pc.onicecandidate=({candidate})=>{const c=candidate?.toJSON()??{candidate:'',sdpMid:null,sdpMLineIndex:null},p={kind:'ice',candidate:c.candidate??'',sdpMid:c.sdpMid??null,sdpMLineIndex:c.sdpMLineIndex??null};if(e.sent)void e.send(p).catch(error=>checks.push({test:'ICE',passed:false,error:error.message}));else e.local.push(p);};
  return e;
}
async function pair(publisher,viewer,iceServers){
  const context={streamId:publisher.streamId,subscriptionId:crypto.randomUUID(),session:crypto.randomUUID()};
  await native('testWatch',{side:viewer.side,publisherId:publisher.id,streamId:publisher.streamId,subscriptionId:context.subscriptionId,active:true});
  await wait(()=>states.get(publisher.side)?.subscribers.some(s=>s.subscriptionId===context.subscriptionId));
  const a=endpoint(publisher.side,viewer.id,context,iceServers),b=endpoint(viewer.side,publisher.id,context,iceServers);
  const received=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('WebRTC timeout')),30000);b.pc.ondatachannel=({channel})=>channel.onmessage=({data})=>{if(data==='probe'){channel.send('echo');clearTimeout(timer);resolve();}};});
  const channel=a.pc.createDataChannel('network-check');
  channel.onopen=()=>channel.send('probe');
  await a.pc.setLocalDescription(await a.pc.createOffer());await a.send({kind:'offer',sdp:a.pc.localDescription.sdp});a.sent=true;for(const c of a.local.splice(0))await a.send(c);
  await received;const route=directRoute(await a.pc.getStats());if(!route.confirmed)throw Error(route.label);
  checks.push({test:'direct subscribed data channel',publisher:publisher.side,viewer:viewer.side,passed:true,localCandidate:route.localType,remoteCandidate:route.remoteType,protocol:route.protocol});
  return {a,b,channel,publisher,viewer,context};
}
async function probe(flow){await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Remaining channel stopped')),5000);flow.channel.onmessage=({data})=>{if(data==='echo'){clearTimeout(timer);resolve();}};flow.channel.send('probe');});}
let runtime;
try{
  await native('ready');const setup=await native('testCreate');runtime=setup.runtime;
  const clients=setup.clients.map(c=>({...c,streamId:crypto.randomUUID()}));
  for(const c of clients)await native('testStream',{side:c.side,streamId:c.streamId,active:true});
  await wait(()=>states.get('host')?.participants.filter(p=>p.streaming).length===5);
  checks.push({test:'five publishers announced with no automatic subscriptions',passed:clients.every(c=>states.get(c.side)?.subscriptions.length===0)});
  const flows=await Promise.all(clients.flatMap(p=>clients.filter(v=>v.id!==p.id).map(v=>pair(p,v,setup.ice.iceServers))));
  checks.push({test:'twenty simultaneous directional P2P subscriptions',passed:flows.length===20});
  const first=flows[0];await native('testWatch',{side:first.viewer.side,publisherId:first.publisher.id,streamId:first.publisher.streamId,subscriptionId:first.context.subscriptionId,active:false});
  await wait(()=>!states.get(first.publisher.side)?.subscribers.some(s=>s.subscriptionId===first.context.subscriptionId));
  first.a.pc.close();first.b.pc.close();
  await Promise.all(flows.slice(1).map(probe));checks.push({test:'unsubscribe one preserves nineteen other channels',passed:true});
  const stopped=clients[1];await native('testStream',{side:stopped.side,streamId:stopped.streamId,active:false});
  await wait(()=>states.get('host')?.participants.filter(p=>p.streaming).length===4);
  const remaining=flows.slice(1).filter(f=>f.publisher.id!==stopped.id);
  for(const f of flows.filter(f=>f.publisher.id===stopped.id)){f.a.pc.close();f.b.pc.close();}
  await Promise.all(remaining.map(probe));
  checks.push({test:'stopping one publisher preserves other streams and its receiving subscriptions',passed:states.get(stopped.side).subscriptions.length>0&&states.get(stopped.side).subscribers.length===0});
  checks.push({test:'STUN only',passed:setup.ice.turnAvailable===false&&setup.ice.iceServers.every(s=>!s.credential&&s.urls.every(u=>u.startsWith('stun:')))});
}catch(e){checks.push({test:'network runner',passed:false,error:e.message});}
finally{
  for(const pc of peers)pc.close();
  const result={passed:checks.length>0&&checks.every(c=>c.passed),runtime,checks,limitation:'Actual DTLS/SCTP channels and subscription signaling on one computer. Stream announcements are metadata only; this runner does not capture or generate audiovisual media and does not validate gameplay, encoders, sync, physical networks or 24-hour endurance.'};
  document.getElementById('result').textContent=JSON.stringify(result,null,2);await native('testResult',result);
}
