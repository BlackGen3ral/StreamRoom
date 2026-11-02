import { RtcRoom } from './rtc-room.mjs';
import { createCapturePicker } from './capture-picker.mjs';
const $ = id => document.getElementById(id), pending = new Map(); let sequence = 0;
function native(type, payload = {}) {
  return new Promise((resolve,reject) => {
    const id=String(++sequence),timer=setTimeout(()=>{pending.delete(id);reject(Error('Tempo de resposta esgotado.'));},25000);
    pending.set(id,{resolve,reject,timer});window.chrome.webview.postMessage({id,type,payload});
  });
}
const rtc=new RtcRoom(native,{relayExperiment:true});
const options=()=>({quality:720,fps:30,upload:4,autoQuality:false,audio:'system'});
const samples=[],errors=[];let state=null,invitation='',role=null,version='',runtime='',startedAt=null,finishedAt=null,ending=false,watchPending=false,latest=[],captureAudio=false;
const status=message=>{$('status').textContent=message;};
function issue(code,message) {errors.push({at:new Date().toISOString(),code});status(message);}
function controls() {
  const connected=Boolean(rtc.identity)&&!ending;
  $('start').disabled=!connected||role!=='host'||state?.participants.length!==2||Boolean(rtc.localStream)||!$('differentNetworks').checked;
  $('finish').disabled=!connected;$('copy').disabled=!connected||role!=='host';
  $('play').disabled=!$('video').srcObject||role!=='viewer';$('join').disabled=connected||ending;
}
async function subscribe() {
  if(role!=='viewer'||watchPending||ending||!rtc.identity)return;
  const source=state?.participants.find(p=>p.role==='host'&&p.streamId);
  if(!source||rtc.subscriptions.some(s=>s.streamId===source.streamId))return;
  watchPending=true;
  try {await rtc.watch(source.id,true,720,30);}catch{issue('watch-failed','Falha ao solicitar a transmissão.');}finally{watchPending=false;}
}
window.chrome.webview.addEventListener('message',({data})=>{
  if(data.type==='reply'){const p=pending.get(data.id);if(!p)return;pending.delete(data.id);clearTimeout(p.timer);data.ok?p.resolve(data.result):p.reject(Error(data.error));}
  else if(data.type==='roomState'){state=data.state;if(rtc.identity)rtc.updateRoom(state);$('participants').textContent=`Pessoas na sala experimental: ${state.participants.length}/2`;controls();void subscribe();}
  else if(data.type==='signal')rtc.enqueueSignal(data.from,data.payload);
  else if(data.type==='pcm')rtc.pushPcm(data.data);
  else if(data.type==='nativeCaptureEnded'){issue('capture-ended',data.message);void finish('A captura foi encerrada.');}
  else if(data.type==='disconnected'){void finish('A sinalização foi encerrada. Preserve os dois relatórios.');}
  else if(data.type==='serverError'){issue('server-error',data.message);void finish('O servidor recusou o teste. Preserve o relatório.');}
  else if(data.type==='audioError'){issue('audio-error','Falha na captura de áudio do sistema.');}
});
async function connect(mode) {
  if(rtc.identity||ending)return;
  $('create').disabled=$('join').disabled=true;
  try {
    const result=await native('connect',{mode,server:$('server').value,name:$('name').value,invite:$('invite').value.trim()});
    invitation=result.invitation;role=result.welcome.role;startedAt=new Date().toISOString();
    rtc.setOptions(options());rtc.enter(result.welcome);if(state)rtc.updateRoom(state);
    status('Sala experimental conectada. Aguarde as duas pessoas antes de capturar.');await subscribe();
  }catch{issue('connect-failed','Teste não conectado. Confira a configuração autorizada, o convite e a janela de ativação.');}
  controls();
}
const picker=createCapturePicker(native,rtc,options,status);
$('create').onclick=()=>connect('create');$('join').onclick=()=>connect('join');
$('differentNetworks').onchange=controls;
$('copy').onclick=()=>native('copy',{text:invitation}).then(()=>status('Convite copiado. Envie em particular somente ao amigo deste teste.')).catch(()=>issue('copy-failed','Não foi possível copiar o convite.'));
$('start').onclick=()=>{if(!$('start').disabled)picker.open();};
$('play').onclick=async()=>{try{$('video').muted=false;await $('video').play();status('Confirme imagem em movimento e áudio audível.');}catch{issue('playback-failed','O vídeo não iniciou. Preserve o relatório.');}};
$('finish').onclick=()=>finish('Teste encerrado pelo usuário.');
rtc.addEventListener('capture',({detail})=>{captureAudio ||= Boolean(detail?.audio);if(detail){$('video').srcObject=detail.stream;$('video').muted=true;if(!detail.audio)issue('no-captured-audio','A fonte não tem áudio: esse resultado não valida o teste audiovisual.');}controls();});
rtc.addEventListener('remote',({detail})=>{if(role==='viewer'){ if($('video').srcObject!==detail.stream){$('video').srcObject=detail.stream;$('video').muted=true;}controls();}});
rtc.addEventListener('notice',()=>issue('rtc-notice','A negociação registrou um aviso. Confira os estados ICE e os códigos no relatório.'));
rtc.addEventListener('connectionError',()=>{issue('rtc-failed','O teste TURN falhou. Não haverá nova tentativa automática.');void finish('Preserve os relatórios dos dois computadores.');});
rtc.addEventListener('experimentEnd',()=>finish('Janela curta do teste encerrada.'));
const fields=['direction','state','failed','turnConfirmed','route','localCandidate','remoteCandidate','transport','fps','bitrate','loss','rtt','width','height','frames','codec','audioPackets','audioBytes','audioCodec','iceState','gathering','candidates','iceErrors','elapsed','stunError','remoteCandidates','descriptionReceived'];
rtc.addEventListener('stats',({detail})=>{
  latest=detail.map(row=>Object.fromEntries(fields.filter(key=>row[key]!==undefined).map(key=>[key,row[key]])));
  if(samples.length<100)samples.push({at:new Date().toISOString(),connections:latest});
  const row=latest[0];$('metrics').textContent=row?`${row.route??'TURN não confirmado'} · ${row.state} · ${row.fps??'—'} FPS · ${row.bitrate?.toFixed(2)??'—'} Mbps · perda ${((row.loss??0)*100).toFixed(1)}% · RTT ${row.rtt===null||row.rtt===undefined?'—':Math.round(row.rtt)} ms`:'Aguardando mídia.';
});
async function finish(message) {
  if(ending)return;ending=true;finishedAt=new Date().toISOString();controls();
  try{await rtc.leave();await native('leave');}catch{errors.push({at:new Date().toISOString(),code:'cleanup-error'});}
  $('video').srcObject=null;status(message);$('summary').textContent='Fim da tentativa. Copie os relatórios dos dois PCs antes de fechar. Este resultado ainda precisa ser comparado entre redes diferentes.';
}
const clock=setInterval(()=>{const end=rtc.iceCache?.expiresAt;if(end&&!ending)$('remaining').textContent=`Credenciais expiram em aproximadamente ${Math.max(0,Math.ceil((end-Date.now())/1000))} s. Este contador não garante limitar cobranças.`;},1000);
function report() {
  const rows=samples.flatMap(s=>s.connections);
  return {format:1,experiment:'turn-relay-proof',version,runtime,role,at:new Date().toISOString(),startedAt,finishedAt,requested:{height:720,fps:30,uploadMbps:4,iceTransportPolicy:'relay'},
    differentNetworksDeclared:$('differentNetworks').checked,captureAudio,viewerConfirmedMotionAndAudibleSound:role==='viewer'&&$('mediaConfirmed').checked,
    localEvidence:{relayPairObserved:rows.some(r=>r.turnConfirmed&&r.state==='connected'),videoFramesObserved:rows.some(r=>r.frames>0),audioPacketsObserved:rows.some(r=>r.audioPackets>0)},
    crossNetworkValidation:'PENDING_COMPARISON_OF_BOTH_REPORTS_AND_HUMAN_AUDIO_VIDEO_CONFIRMATION',errors,samples};
}
$('export').onclick=()=>native('copy',{text:JSON.stringify(report(),null,2)}).then(()=>status('Relatório copiado sem IPs, convites, SDP, credenciais ou nomes de conta.')).catch(()=>status('Falha ao copiar relatório.'));
window.streamroom={shutdown:async()=>{clearInterval(clock);ending=true;await rtc.shutdown();}};
try{const ready=await native('ready');version=ready.version;runtime=ready.runtime;const setup=await native('turnProofReady');$('server').value=setup.server;$('create').disabled=!setup.canCreate;status(setup.canCreate?'Servidor configurado. Confirme a autorização do teste antes de criar.':'Aguardando ativação autorizada. O espectador precisa apenas do convite experimental.');if(ready.uiPreview)setTimeout(()=>native('uiPreview'),1000);}
catch{issue('setup-failed','Este pacote não está configurado como experimento TURN autorizado.');}
