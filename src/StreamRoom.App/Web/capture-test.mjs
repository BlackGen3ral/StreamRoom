import { WgcStream } from './wgc-stream.mjs';
let sequence = 0; const requests = new Map();
function native(type, payload = {}) {
  return new Promise((resolve,reject) => { const id=String(++sequence); requests.set(id,{resolve,reject}); window.chrome.webview.postMessage({id,type,payload}); });
}
window.chrome.webview.addEventListener('message',({data})=>{
  if(data.type==='reply') { const r=requests.get(data.id); if(r) { requests.delete(data.id); data.ok?r.resolve(data.result):r.reject(Error(data.error)); } }
});
const bridge = new WgcStream(native, error => { document.getElementById('testStatus').textContent = error; });
const a=new RTCPeerConnection(), b=new RTCPeerConnection();
let chromiumCalled=false, result;
const log=step=>{document.getElementById('testStatus').textContent=step;void native('captureTestLog',{step});};
window.addEventListener('unhandledrejection',e=>log('Unhandled: '+e.reason));
navigator.mediaDevices.getDisplayMedia=()=>{chromiumCalled=true; throw Error('Chromium picker must never be used.');};
const marker=document.getElementById('testMarker');
let move=false; const animation=setInterval(()=>{move=!move;marker.style.marginLeft=move?'15px':'0';},16);
const deadline=setTimeout(()=>native('captureTestResult',{success:false,error:'Bridge test timed out'}),25000);
async function gather(pc) { if(pc.iceGatheringState==='complete')return;await new Promise(resolve=>pc.addEventListener('icegatheringstatechange',()=>{if(pc.iceGatheringState==='complete')resolve();})); }
try {
  await native('ready');log('source');const source=await native('captureTestSource');
  log('start');const stream=await bridge.start(source.id,{quality:1080,fps:60});
  log('captured');const remote=new Promise(resolve=>{b.ontrack=e=>resolve(e.streams[0]);});
  for(const track of stream.getTracks())a.addTrack(track,stream);
  const codecs=RTCRtpSender.getCapabilities('video')?.codecs ?? [];
  const transceiver=a.getTransceivers().find(t=>t.sender.track?.kind==='video');
  if(transceiver?.setCodecPreferences) transceiver.setCodecPreferences([...codecs.filter(c=>c.mimeType.toLowerCase()==='video/h264'),...codecs.filter(c=>c.mimeType.toLowerCase()!=='video/h264')]);
  log('offer');await a.setLocalDescription(await a.createOffer());await gather(a);log('gatherA');
  await b.setRemoteDescription(a.localDescription);await b.setLocalDescription(await b.createAnswer());await gather(b);log('gatherB');
  await a.setRemoteDescription(b.localDescription);
  const sender=a.getSenders().find(s=>s.track?.kind==='video');
  const parameters=sender.getParameters(); parameters.degradationPreference='maintain-resolution';
  parameters.encodings[0].maxBitrate=20_000_000; parameters.encodings[0].maxFramerate=60; parameters.encodings[0].scaleResolutionDownBy=1;
  await sender.setParameters(parameters);
  log('remote');const video=document.getElementById('testVideo');video.srcObject=await remote;await video.play();log('playing');
  await new Promise(resolve=>setTimeout(resolve,6000));
  const sent=[...(await a.getStats()).values()].find(s=>s.type==='outbound-rtp'&&s.kind==='video');
  const stats=[...(await b.getStats()).values()].filter(s=>s.type==='inbound-rtp'&&s.kind==='video');
  const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
  const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0);
  const pixel=ctx.getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data;
  const greenPixel=pixel[1]>pixel[0]+30&&pixel[1]>pixel[2]+30;
  result={success:!chromiumCalled&&greenPixel&&stats.some(s=>s.framesDecoded>5),chromiumCalled,greenPixel,transport:bridge.transport,sent:{width:sent?.frameWidth,height:sent?.frameHeight,fps:sent?.framesPerSecond,frames:sent?.framesEncoded,encoder:sent?.encoderImplementation,limitation:sent?.qualityLimitationReason},width:video.videoWidth,height:video.videoHeight,stats:stats.map(s=>({framesDecoded:s.framesDecoded,framesPerSecond:s.framesPerSecond,decoderImplementation:s.decoderImplementation}))};
} catch(e){log(e.stack);result={success:false,error:e.stack};}
finally {clearTimeout(deadline);clearInterval(animation);a.close();b.close();await bridge.stop();await native('captureTestResult',result);}
