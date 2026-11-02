import { RtcRoom } from './rtc-room.mjs';
import { WgcStream } from './wgc-stream.mjs';
let sequence = 0, pending = new Map(), state, setup, bridge;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const native = (type,payload={}) => new Promise((resolve,reject) => {
 const id=String(++sequence), timer=setTimeout(()=>{pending.delete(id);reject(Error(type+' timeout'));},30000);
 pending.set(id,{resolve,reject,timer});window.chrome.webview.postMessage({id,type,payload});
});
const rtc=new RtcRoom(native), rows=[], notices=[];
rtc.addEventListener('notice',e=>notices.push(e.detail));
rtc.addEventListener('connectionError',e=>notices.push(e.detail.message));
window.chrome.webview.addEventListener('message',({data})=>{
 if(data.type==='reply'){const r=pending.get(data.id);if(r){clearTimeout(r.timer);pending.delete(data.id);data.ok?r.resolve(data.result):r.reject(Error(data.error));}}
 else if(data.type==='roomState'){state=data.state;if(rtc.identity)rtc.updateRoom(state);}
 else if(data.type==='signal')rtc.enqueueSignal(data.from,data.payload);
 else if(data.type==='nativeCaptureEnded') { if (bridge?.session===data.session) document.getElementById('progress').textContent=data.message; }
});
rtc.addEventListener('stats',e=>{for(const row of e.detail)rows.push({...row,time:performance.now()});});
window.streamroom={shutdown:()=>rtc.shutdown()};
async function wait(predicate,ms=25000){const start=performance.now();while(!predicate()){if(performance.now()-start>ms)throw Error('Condition timeout');await delay(100);}}
let result;
try{
 await native('ready');setup=await native('mediaTestSetup');
 let invite='';
 if(setup.role==='viewer'){for(let i=0;i<100&&!invite;i++){invite=await native('mediaTestInvite');if(!invite)await delay(200);}if(!invite)throw Error('Missing invitation');}
 const connected=await native('connect',{mode:setup.role==='host'?'create':'join',server:setup.server,name:'Media test '+setup.role,invite});
 rtc.enter(connected.welcome);if(state)rtc.updateRoom(state);
 if(setup.role==='host'){
  await native('mediaTestInvite',{invitation:connected.invitation});
  const source=await native('mediaTestMonitor');
  bridge=new WgcStream(native,message=>{throw Error(message);});
  await rtc.startCapture({quality:setup.quality,fps:setup.fps,audio:'none',upload:24,autoQuality:true,nativeSource:{bridge,sourceId:source.id}});
  await wait(()=>rtc.subscribers.length>0);
  await delay(6000);const background=await native('mediaTestState',{minimized:true});
  await delay(8000);const transfer=await native('mediaTestState',{minimized:false});
  await delay(6000);
  const connectedAt=rows.find(r=>r.direction==='send'&&r.state==='connected')?.time??Infinity;
  const stable=rows.filter(r=>r.direction==='send'&&r.time>=connectedAt+4000);
  result={success:stable.length>=6&&stable.every(r=>r.fps>=20)&&background.hidden&&background.connected&&!background.closing&&!transfer.hidden,role:setup.role,background,transfer,transport:bridge.transport,rows};
 }else{
  await wait(()=>state?.participants.some(p=>p.streamId));
  const publisher=state.participants.find(p=>p.streamId);
  let remote;
  rtc.addEventListener('remote',e=>{if(e.detail.stream){remote=e.detail.stream;document.getElementById('remote').srcObject=remote;}});
  await rtc.watch(publisher.id,true,setup.quality,setup.fps);await wait(()=>remote);
  await document.getElementById('remote').play();
  const started = performance.now();
  await delay(18000);
  const received=rows.filter(r=>r.direction==='receive');
  const stable=received.filter(r=>r.time>=started+4000);
  result={success:stable.length>=6&&stable.every(r=>r.fps>=20),role:setup.role,minFps:Math.min(...stable.map(r=>r.fps??0)),rows:received};
 }
}catch(e){result={success:false,role:setup?.role,error:e.stack??String(e),rows};}
finally{await native('mediaTestResult',{...result,notices});}
