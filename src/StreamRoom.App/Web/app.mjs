import { RtcRoom } from './rtc-room.mjs';
import { createCapturePicker } from './capture-picker.mjs';
const $ = id => document.getElementById(id);
const requests = new Map(); let sequence = 0;
function native(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = String(++sequence);
    const timer = setTimeout(() => { requests.delete(id); reject(Error('O aplicativo demorou para responder. Tente novamente.')); }, type === 'downloadUpdate' ? 900000 : type === 'checkUpdates' ? 120000 : type === 'connect' ? 45000 : 25000);
    requests.set(id, { resolve, reject, timer }); window.chrome.webview.postMessage({ id, type, payload });
  });
}
const rtc = new RtcRoom(native);
const state = { connected: false, role: null, invitation: '', participants: [], room: null, busy: false, shuttingDown: false };
let updateBusy = false, updateReady = false;
const cards = new Map(), remoteStreams = new Map();
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function options() { return { quality: Number($('quality').value), fps: Number($('fps').value), audio: $('audio').value, autoQuality: $('autoQuality').checked, upload: Number($('upload').value) }; }
function node(tag, className, text) { const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; }
function button(text, action) { const e = node('button', 'quiet', text); e.addEventListener('click', action); return e; }
function quality(card) { const [height, fps] = card.quality.value.split(':').map(Number); return { height, fps }; }
function createCard(id, streamId) {
  const own = id === rtc.identity?.participantId, card = { id, streamId, own };
  card.root = node('section', 'stream-card card'); card.root.dataset.publisher = id;
  const heading = node('div', 'section-title'); card.title = node('h2'); heading.append(card.title, node('span', 'muted', own ? 'Sua transmissão' : 'Ao vivo'));
  card.frame = node('div', 'player-card'); card.video = node('video'); card.video.autoplay = true; card.video.playsInline = true; card.video.muted = true;
  card.empty = node('p', 'stream-placeholder', own ? 'Prévia local sem som' : 'Escolha Assistir para receber esta gameplay.');
  card.play = button('▶ Reproduzir', async () => { try { await card.video.play(); card.play.hidden = true; } catch (e) { status(e.message, true); } }); card.play.className = 'overlay-play'; card.play.hidden = true;
  card.frame.append(card.video, card.empty, card.play);
  const controls = node('div', 'stream-controls');
  card.watch = button(own ? 'Parar minha transmissão' : 'Assistir', () => busy(async () => {
    if (own) { await rtc.stopCapture(); status('Sua transmissão parou. As demais continuam.'); return; }
    const watching = rtc.subscriptions.some(s => s.publisherId === id);
    await rtc.watch(id, !watching, quality(card).height, quality(card).fps);
  }));
  card.quality = node('select'); card.quality.setAttribute('aria-label', 'Qualidade de ' + id);
  for (const [value, label] of [['480:30','480p · 30 FPS'],['720:30','720p · 30 FPS'],['720:60','720p · 60 FPS'],['1080:30','1080p · 30 FPS'],['1080:60','1080p · 60 FPS']]) {
    const option = node('option', '', label); option.value = value; card.quality.append(option);
  }
  card.quality.hidden = own;
  card.quality.addEventListener('change', () => busy(async () => { if (rtc.subscriptions.some(s => s.publisherId === id)) await rtc.watch(id, true, quality(card).height, quality(card).fps); }));
  card.mute = button('Ativar som', async () => { card.video.muted = !card.video.muted; card.mute.textContent = card.video.muted ? 'Ativar som' : 'Silenciar'; });
  card.mute.hidden = own;
  card.volume = node('input'); card.volume.type = 'range'; card.volume.min = '0'; card.volume.max = '1'; card.volume.step = '.01'; card.volume.value = '.8'; card.video.volume = .8; card.volume.hidden = own;
  card.volume.setAttribute('aria-label', 'Volume desta transmissão');
  card.volume.addEventListener('input', () => { card.video.volume = Number(card.volume.value); card.video.muted = card.video.volume === 0; card.mute.textContent = card.video.muted ? 'Ativar som' : 'Silenciar'; });
  const enlarge = button('Destacar', () => { const focused = card.root.classList.toggle('expanded'); enlarge.textContent = focused ? 'Voltar à grade' : 'Destacar'; });
  const fullscreen = button('Tela cheia', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await card.root.requestFullscreen(); } catch (e) { status(e.message, true); } });
  card.pause = button('Pausar reprodução', async () => {
    if (!card.video.srcObject) return;
    if (card.video.paused) {
      try { await card.video.play(); card.play.hidden = true; } catch (e) { status(e.message, true); }
    } else card.video.pause();
  });
  const syncPlayback = () => { card.pause.textContent = card.video.paused ? 'Retomar reprodução' : 'Pausar reprodução'; };
  card.video.addEventListener('play', syncPlayback); card.video.addEventListener('pause', syncPlayback);
  const fit = node('select'); fit.setAttribute('aria-label', 'Enquadramento do vídeo');
  for (const [value, label] of [['contain','Vídeo inteiro'],['cover','Preencher área']]) {
    const option = node('option', '', label); option.value = value; fit.append(option);
  }
  fit.addEventListener('change', () => { card.video.style.objectFit = fit.value; });
  const more = node('details', 'stream-more'); more.append(node('summary', '', 'Mais opções'));
  const extra = node('div', 'stream-extra'); extra.append(card.pause, fit, enlarge); more.append(extra);
  controls.append(card.watch, card.quality, card.mute, card.volume, fullscreen, more);
  card.metrics = node('p', 'fine', own ? 'Sem espectadores: nenhum vídeo é enviado.' : 'Sem recepção: nenhum vídeo é solicitado.');
  card.root.append(heading, card.frame, controls, card.metrics); cards.set(id, card); $('streamGrid').append(card.root); return card;
}
function renderStreams() {
  const streams = state.participants.filter(p => p.streamId).map(p => ({ ...p }));
  if (rtc.localStream && rtc.identity) {
    const self = streams.find(p => p.id === rtc.identity.participantId);
    if (self) self.streamId = rtc.localId;
    else streams.unshift({ id: rtc.identity.participantId, name: 'Você', streamId: rtc.localId });
  }
  const valid = new Set(streams.map(p => p.id));
  for (const [id, card] of cards) if (!valid.has(id) || streams.find(p => p.id === id).streamId !== card.streamId) {
    card.video.pause(); card.video.srcObject = null; card.root.remove(); cards.delete(id); remoteStreams.delete(id);
  }
  for (const p of streams) {
    const card = cards.get(p.id) ?? createCard(p.id, p.streamId);
    const watched = rtc.subscriptions.some(s => s.publisherId === p.id && s.streamId === p.streamId);
    card.title.textContent = p.name + (card.own ? ' · você' : '');
    card.quality.setAttribute('aria-label', 'Qualidade de ' + p.name);
    const stream = card.own ? rtc.localStream : watched && remoteStreams.get(p.id)?.streamId === p.streamId ? remoteStreams.get(p.id).stream : null;
    if (card.video.srcObject !== stream) {
      card.video.srcObject = stream; card.play.hidden = true;
      if (stream) card.video.play().catch(() => { card.play.hidden = false; });
    }
    card.empty.hidden = Boolean(stream);
    card.empty.textContent = card.own ? 'Prévia local sem som' : watched ? 'Conectando P2P direto...' : 'Escolha Assistir para receber esta gameplay.';
    card.watch.textContent = card.own ? 'Parar minha transmissão' : watched ? 'Parar de assistir' : 'Assistir';
    card.watch.disabled = state.busy; card.quality.disabled = state.busy;
    card.mute.disabled = card.volume.disabled = card.pause.disabled = !stream;
    if (!watched && !card.own) card.metrics.textContent = 'Sem recepção: nenhum vídeo é solicitado.';
  }
  $('streamGrid').hidden = streams.length === 0; $('playerEmpty').hidden = streams.length !== 0;
}
function renderProfile() {
  const name = $('name').value.trim() || 'Você';
  $('profileName').textContent = name;
  $('profileAvatar').textContent = name.slice(0, 1).toUpperCase();
  $('profileStatus').textContent = rtc.localStream ? 'Compartilhando tela' : state.connected ? 'Conectado à sala' : 'Pronto para entrar';
}
function render() {
  renderProfile();
  $('headerRoom').textContent = state.connected ? 'Sala conectada' : 'Sua sala';
  document.body.classList.toggle('in-room', state.connected);
  $('installUpdate').disabled = !updateReady || state.connected;
  if (updateReady) $('installUpdate').textContent = state.connected ? 'Saia da sala para atualizar' : 'Reiniciar e atualizar';
  $('entryControls').hidden = state.connected; $('roomControls').hidden = !state.connected;
  $('create').disabled = $('join').disabled = $('paste').disabled = state.busy;
  $('leave').disabled = state.busy; $('name').disabled = state.connected || state.busy; $('server').disabled = state.connected || state.busy;
  $('start').disabled = !state.connected || state.busy || Boolean(rtc.localStream);
  $('startCompatible').hidden = Boolean(rtc.localStream);
  $('startCompatible').disabled = !state.connected || state.busy;
  $('captureSetup').hidden = Boolean(rtc.localStream);
  if (!rtc.localStream) $('source').textContent = state.connected ? 'Você confirma a fonte no seletor.' : 'Entre em uma sala para começar.';
  $('start').hidden = Boolean(rtc.localStream); $('stop').hidden = !rtc.localStream; $('stop').disabled = state.busy;
  for (const id of ['quality', 'fps', 'audio']) $(id).disabled = Boolean(rtc.localStream);
  $('networkBadge').textContent = state.connected ? 'Sala conectada' : 'Desconectado'; $('networkBadge').classList.toggle('connected', state.connected);
  $('participantCount').textContent = state.participants.length + '/5'; $('emptyPeers').hidden = state.participants.length > 0;
  $('leave').textContent = state.role === 'host' ? 'Encerrar sala para todos' : 'Sair da sala';
  $('roomState').textContent = 'TELA COMPARTILHADA';
  $('title').textContent = 'Transmissões';
  $('emptyTitle').textContent = state.connected ? 'Sua sala está pronta.' : 'Nenhuma transmissão';
  $('emptyDescription').textContent = state.connected ? 'Compartilhe sua tela ou escolha uma transmissão para assistir.' : 'Crie uma sala ou entre com um convite.';
  $('participants').replaceChildren(...state.participants.map(p => {
    const li = node('li'), details = node('div'); details.append(node('div','peer-name',p.name + (p.id === rtc.identity?.participantId ? ' (você)' : '')), node('div','peer-role',(p.role === 'host' ? 'Criador da sala' : 'Amigo') + (p.streamId ? ' · transmitindo' : '')));
    li.append(node('span','avatar',p.name.slice(0,1).toUpperCase()),details); return li;
  }));
  renderStreams();
}
async function busy(action) {
  if (state.busy) return; state.busy = true; render();
  try { await action(); } catch (e) { status(e.name === 'NotAllowedError' ? 'Compartilhamento cancelado ou não autorizado. Escolha uma fonte quando quiser.' : e.message, e.name !== 'NotAllowedError'); }
  finally { state.busy = false; render(); }
}
async function save() { await native('settings', { server: $('server').value.trim(), name: $('name').value.trim(), ...options() }); }
async function connect(mode) {
  state.participants = []; state.room = null; await save();
  status(mode === 'create' ? 'Criando sala...' : 'Entrando na sala...');
  const response = await native('connect', { mode, server: $('server').value.trim(), name: $('name').value.trim(), invite: $('invite').value.trim() });
  state.connected = true; state.role = response.welcome.role; state.invitation = response.invitation; state.roomId = response.welcome.roomId;
  rtc.setOptions(options()); rtc.enter(response.welcome); if (state.room) rtc.updateRoom(state.room);
  showExpiry(response.welcome.expiresAt); $('invite').value = '';
  status('Sala pronta. Você pode transmitir e escolher quais gameplays assistir.'); void rtc.ice().catch(e => status(e.message, true));
}
async function disconnected(message) {
  if (state.shuttingDown) return;
  state.connected = false; state.role = null; state.invitation = ''; state.participants = []; state.room = null;
  await rtc.leave(); remoteStreams.clear(); $('source').textContent = 'Nenhuma fonte selecionada'; status(message); render();
}
window.chrome.webview.addEventListener('message', ({ data }) => {
  if (data.type === 'reply') {
    const r = requests.get(data.id); if (!r) return; requests.delete(data.id); clearTimeout(r.timer); data.ok ? r.resolve(data.result) : r.reject(Error(data.error));
  } else if (data.type === 'roomState') { state.room = data.state; state.participants = data.state.participants; if (rtc.identity) rtc.updateRoom(data.state); render(); }
  else if (data.type === 'signal') rtc.enqueueSignal(data.from, data.payload);
  else if (data.type === 'disconnected') void disconnected(data.message);
  else if (data.type === 'serverError' || data.type === 'audioError') status(data.message, true);
  else if (data.type === 'nativeCaptureEnded') { if (rtc.nativeBridge?.session === data.session) { status(data.message, true); void rtc.stopCapture(); } }
  else if (data.type === 'pcm') rtc.pushPcm(data.data);
  else if (data.type === 'roomRenewed') showExpiry(data.expiresAt);
  else if (data.type === 'update') showUpdate(data.result);
  else if (data.type === 'updateProgress') { $('updateText').textContent = 'Baixando atualização… ' + data.progress + '%'; $('updateDownloadProgress').value = data.progress; }
});
rtc.addEventListener('notice', e => status(e.detail));
rtc.addEventListener('connectionError', ({ detail }) => {
  const name = state.participants.find(p => p.id === detail.id)?.name ?? 'Participante';
  status(name + ': ' + detail.message + ' Pare de assistir e selecione novamente para tentar outra vez.', true);
});
rtc.addEventListener('capture', ({ detail }) => {
  $('source').textContent = detail ? 'Compartilhando: ' + (detail.source || 'fonte selecionada') + ' · prévia sem som' : 'Nenhuma fonte selecionada';
  if (detail) status('Captura real iniciada: ' + detail.settings.width + '×' + detail.settings.height + '. Vídeo é enviado somente a quem escolher assistir. ' + (detail.audio ? 'Faixa de áudio ativa.' : 'Sem faixa de áudio.'));
  render();
});
rtc.addEventListener('remote', ({ detail }) => {
  if (detail.stream) remoteStreams.set(detail.id, detail);
  else if (remoteStreams.get(detail.id)?.streamId === detail.streamId) remoteStreams.delete(detail.id);
  renderStreams();
});
rtc.addEventListener('peerState', ({ detail }) => {
  if (detail.state === 'failed' || detail.state === 'disconnected') status('Reconectando uma transmissão; as outras continuam.');
});
rtc.addEventListener('stats', ({ detail }) => {
  $('directStatus').textContent = detail.length && detail.every(r => r.direct) ? 'P2P direto confirmado · sem relay' : 'STUN gratuito · aguardando P2P';
  $('stats').replaceChildren(...detail.map(row => {
    const name = state.participants.find(p => p.id === row.id)?.name ?? 'Participante';
    const text = (row.direction === 'send' ? 'Enviando para ' : 'Recebendo de ') + name + ' · ' + (row.width ? row.width + '×' + row.height : '—') + ' · ' + (row.fps === null ? '—' : Math.round(row.fps)) + ' FPS · ' + (row.bitrate === null ? '—' : row.bitrate.toFixed(2)) + ' Mbps · ' + row.codec + ' · ' + row.route + ' · ICE ' + row.localCandidate + '/' + row.remoteCandidate + ' · ' + row.transport + ' · perda ' + (row.loss * 100).toFixed(1) + '% · RTT ' + (row.rtt === null ? '—' : Math.round(row.rtt) + ' ms') + ' · ' + row.hardware;
    return node('p','fine',text);
  }));
  if (!detail.length) $('stats').textContent = 'Sem conexões de mídia. Escolha uma transmissão para assistir.';
  for (const card of cards.values()) {
    const rows = detail.filter(r => r.publisherId === card.id);
    card.metrics.textContent = card.own ? rtc.subscribers.length + ' espectador(es) selecionaram sua transmissão · ' + (rows.length ? rows.reduce((sum,r)=>sum+(r.bitrate??0),0).toFixed(2) + ' Mbps enviados' : 'nenhum vídeo enviado')
      : rows.length ? (rows[0].width ?? '—') + '×' + (rows[0].height ?? '—') + ' · ' + (rows[0].fps === null ? '—' : Math.round(rows[0].fps)) + ' FPS · ' + rows[0].route : 'Sem recepção ativa.';
  }
});
function showExpiry(expiresAt) {
  $('roomCode').textContent = 'Sala ' + (state.roomId ?? '').slice(0,8);
  $('roomCode').title = 'Próxima renovação antes de ' + new Date(expiresAt).toLocaleString('pt-BR');
  $('roomLifetime').textContent = state.role === 'host' ? 'Renovação automática enquanto você estiver conectado. Sem limite total de duração.' : 'A sala continua ativa enquanto o criador estiver conectado.';
}
function showUpdate(r) {
  if (!r.available) { if (r.message) status(r.message); return; }
  $('updateNotice').hidden = false;
  if (r.downloaded) { markUpdateReady(); return; }
  if (!updateBusy) void downloadUpdate();
}
function markUpdateReady() {
  updateReady = true;
  $('updateDownloadProgress').hidden = true;
  $('updateText').textContent = 'Atualização pronta. Reinicie quando quiser.';
  $('updateButton').textContent = 'Atualização pronta';
  $('updateButton').disabled = true;
  render();
}
async function downloadUpdate() {
  if (updateBusy || updateReady) return;
  updateBusy = true;
  $('updateNotice').hidden = false;
  $('updateButton').disabled = true;
  $('updateButton').textContent = 'Baixando…';
  $('installUpdate').disabled = true;
  $('updateText').textContent = 'Preparando download…';
  $('updateDownloadProgress').hidden = false;
  $('updateDownloadProgress').value = 0;
  try { await native('downloadUpdate'); markUpdateReady(); }
  catch (e) {
    $('updateText').textContent = 'Download não concluído: ' + e.message;
    $('updateButton').textContent = 'Tentar novamente';
    $('updateDownloadProgress').hidden = true;
  } finally { updateBusy = false; if (!updateReady) $('updateButton').disabled = false; }
}
async function checkUpdates() {
  if (updateBusy || updateReady) return;
  updateBusy = true;
  $('updateButton').disabled = true;
  $('updateButton').textContent = 'Verificando…';
  let result;
  try { result = await native('checkUpdates'); }
  catch (e) { status(e.message, true); }
  finally { updateBusy = false; $('updateButton').disabled = false; $('updateButton').textContent = 'Verificar atualização'; }
  if (result) showUpdate(result);
}
$('name').addEventListener('input', renderProfile);
$('showStage').addEventListener('click', () => $('stage').scrollIntoView({ block: 'start' }));
$('showSettings').addEventListener('click', () => { $('settings').open = true; $('settings').scrollIntoView({ block: 'nearest' }); $('quality').focus(); });
$('create').addEventListener('click', () => busy(() => connect('create')));
$('join').addEventListener('click', () => busy(() => connect('join')));
$('copy').addEventListener('click', () => busy(async () => { await native('copy',{text:state.invitation}); status('Convite copiado.'); }));
$('paste').addEventListener('click', () => busy(async () => { $('invite').value = await native('paste'); }));
$('leave').addEventListener('click', () => busy(async () => { await rtc.leave(); await native('leave'); await disconnected('Você saiu da sala.'); }));
const capturePicker = createCapturePicker(native, rtc, options, status);
$('start').addEventListener('click', () => capturePicker.open());
$('startCompatible').addEventListener('click', () => busy(() => rtc.startCapture(options())));
$('stop').addEventListener('click', () => busy(async () => { await rtc.stopCapture(); status('Sua transmissão parou. As demais continuam.'); }));
$('updateButton').addEventListener('click', checkUpdates);
$('installUpdate').addEventListener('click', () => busy(async () => { if (state.connected) throw Error('Saia da sala antes de atualizar.'); await native('installUpdate'); }));
for (const id of ['quality','fps','autoQuality','upload']) $(id).addEventListener('change', () => { rtc.setOptions(options()); void save().catch(e => status(e.message,true)); });
$('audio').addEventListener('change', () => { $('audioHint').textContent = $('audio').value === 'system' ? 'WASAPI captura todo o sistema, incluindo Discord e outras gameplays que você estiver ouvindo. Pode causar retorno. Prefira áudio da janela.' : $('audio').value === 'none' ? 'Apenas vídeo.' : 'Escolha a janela do jogo e habilite áudio no seletor. Depende do Windows/WebView2.'; });
window.streamroom = { shutdown: async () => { state.shuttingDown = true; await rtc.shutdown(); }, diagnostics: () => ({ peers: rtc.peers.size, sending: rtc.subscribers.length, watching: rtc.subscriptions.length }) };
try {
  const r = await native('ready');
  for (const [key,value] of Object.entries(r.settings ?? {})) { const input=$(key); if (!input) continue; if(input.type==='checkbox') input.checked=Boolean(value); else input.value=String(value); }
  $('version').textContent=r.version+' · desenvolvimento'; $('runtime').textContent='Motor WebView2 '+r.runtime; $('footerVersion').textContent='StreamRoom '+r.version+' · build de desenvolvimento';
  if (!isSecureContext || !navigator.mediaDevices?.getDisplayMedia || !globalThis.RTCPeerConnection) status('Atualize o Microsoft Edge WebView2 Runtime para captura/WebRTC.',true);
  if (r.uiPreview) setTimeout(() => native('uiPreview'), 1500);
  if (r.capturePreview) { capturePicker.open(); setTimeout(() => native('capturePreview'), 6000); }
  if(r.installed) setTimeout(checkUpdates,5000);
} catch(e) {status('Falha ao iniciar: '+e.message,true);}
render();
