import { RtcRoom } from './rtc-room.mjs';
const $ = id => document.getElementById(id);
const requests = new Map(); let sequence = 0;
function native(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = String(++sequence);
    const timer = setTimeout(() => { requests.delete(id); reject(Error('O aplicativo demorou para responder. Tente novamente.')); }, type === 'connect' ? 45000 : 25000);
    requests.set(id, { resolve, reject, timer });
    window.chrome.webview.postMessage({ id, type, payload });
  });
}
const rtc = new RtcRoom(native);
const state = { connected: false, connecting: false, role: null, invitation: '', participants: [], streaming: false, busy: false, shuttingDown: false };
const player = $('player');
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function options() { return { quality: Number($('quality').value), fps: Number($('fps').value), audio: $('audio').value, autoQuality: $('autoQuality').checked, upload: Number($('upload').value) }; }
function render() {
  $('entryControls').hidden = state.connected; $('roomControls').hidden = !state.connected;
  $('create').disabled = $('join').disabled = $('paste').disabled = state.busy;
  $('leave').disabled = state.busy; $('name').disabled = state.connected || state.busy;
  $('server').disabled = state.connected || state.busy;
  const host = state.connected && state.role === 'host';
  $('start').disabled = !host || state.busy || Boolean(rtc.localStream);
  $('start').hidden = Boolean(rtc.localStream); $('stop').hidden = !rtc.localStream; $('stop').disabled = state.busy;
  for (const id of ['quality', 'fps']) $(id).disabled = Boolean(rtc.localStream);
  for (const id of ['audio']) $(id).disabled = Boolean(rtc.localStream) || (state.connected && !host);
  $('networkBadge').textContent = state.connected ? '● Sala conectada' : 'Desconectado'; $('networkBadge').classList.toggle('connected', state.connected);
  $('participantCount').textContent = state.participants.length + '/5'; $('emptyPeers').hidden = state.participants.length > 0;
  $('leave').textContent = host ? 'Encerrar sala para todos' : 'Sair da sala';
  $('roomState').textContent = state.connected ? (host ? 'SUA SALA PRIVADA' : 'VOCÊ ESTÁ NA SALA') : 'SEU PONTO DE ENCONTRO';
  $('title').textContent = state.connected ? (host ? 'Compartilhe a próxima partida.' : 'Sente, relaxe e acompanhe.') : 'O jogo fica melhor junto.';
  $('emptyTitle').textContent = state.connected ? (host ? 'Escolha o que compartilhar.' : 'Aguardando a transmissão.') : 'A próxima partida começa aqui.';
  $('emptyDescription').textContent = state.connected ? (host ? 'Abra o seletor e escolha seu jogo, uma janela ou um monitor.' : 'O criador inicia e controla a fonte da transmissão.') : 'Crie uma sala e compartilhe seu jogo, uma janela ou um monitor.';
  $('participants').replaceChildren(...state.participants.map(p => {
    const li = document.createElement('li'); const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = p.name.slice(0, 1).toUpperCase();
    const details = document.createElement('div'); const name = document.createElement('div'); name.className = 'peer-name'; name.textContent = p.name + (p.id === rtc.identity?.participantId ? ' (você)' : '');
    const role = document.createElement('div'); role.className = 'peer-role'; role.textContent = p.role === 'host' ? 'Criador · transmissor' : 'Espectador';
    details.append(name, role); li.append(avatar, details); return li;
  }));
}
function showStream(stream, preview = false) {
  player.srcObject = stream; player.muted = preview; player.volume = Number($('volume').value);
  $('playerEmpty').hidden = Boolean(stream); $('liveBadge').hidden = !stream; $('play').hidden = true;
  if (stream) player.play().catch(() => { $('play').hidden = false; });
}
async function busy(action) {
  if (state.busy) return;
  state.busy = true; render();
  try { await action(); }
  catch (error) { status(error.name === 'NotAllowedError' ? 'Captura cancelada ou não autorizada. Clique em transmitir para tentar novamente.' : error.message, true); }
  finally { state.busy = false; render(); }
}
async function save() { await native('settings', { server: $('server').value.trim(), name: $('name').value.trim(), ...options(), volume: Number($('volume').value) }); }
async function connect(mode) {
  state.connecting = true; state.participants = []; state.streaming = false;
  try {
    await save();
    status(mode === 'create' ? 'Criando sua sala...' : 'Entrando na sala...');
    const response = await native('connect', { mode, server: $('server').value.trim(), name: $('name').value.trim(), invite: $('invite').value.trim() });
    state.connected = true; state.role = response.welcome.role; state.invitation = response.invitation;
    rtc.setOptions(options()); rtc.enter(response.welcome); rtc.updateRoom(state.participants, state.streaming);
    state.roomId = response.welcome.roomId; showExpiry(response.welcome.expiresAt);
    $('invite').value = '';
    status(state.role === 'host' ? 'Sala pronta. Copie o convite para seus amigos e selecione a fonte para transmitir.' : 'Você entrou. A transmissão aparece aqui quando o criador iniciar.');
    // Resolve STUN now, independently of the user gesture needed by the capture picker.
    rtc.ice().catch(error => status(error.message, true));
    rtc.requestQuality().catch(error => status(error.message, true));
  } finally { state.connecting = false; }
}
async function disconnected(message) {
  if (state.shuttingDown) return;
  state.connected = false; state.role = null; state.invitation = ''; state.participants = []; state.streaming = false;
  await rtc.leave(); showStream(null); $('source').textContent = 'Nenhuma fonte selecionada';
  status(message); render();
}
window.chrome.webview.addEventListener('message', ({ data }) => {
  if (data.type === 'reply') {
    const request = requests.get(data.id); if (!request) return;
    requests.delete(data.id); clearTimeout(request.timer);
    if (data.ok) request.resolve(data.result); else request.reject(Error(data.error));
  } else if (data.type === 'participants') {
    state.participants = data.participants; rtc.updateRoom(data.participants, undefined); render();
  } else if (data.type === 'streamState') {
    state.streaming = data.active; rtc.updateRoom(null, data.active);
  } else if (data.type === 'signal') rtc.enqueueSignal(data.from, data.payload);
  else if (data.type === 'disconnected') void disconnected(data.message);
  else if (data.type === 'serverError' || data.type === 'audioError') status(data.message, true);
  else if (data.type === 'pcm') rtc.pushPcm(data.data);
  else if (data.type === 'roomRenewed') showExpiry(data.expiresAt);
  else if (data.type === 'update') showUpdate(data.result);
  else if (data.type === 'updateProgress') status(`Baixando atualização oficial: ${data.progress}%`);
});
rtc.addEventListener('notice', e => status(e.detail));
rtc.addEventListener('ice', () => { $('directStatus').textContent = 'STUN gratuito · aguardando P2P'; });
rtc.addEventListener('connectionError', ({ detail }) => status(detail.message, true));
rtc.addEventListener('capture', ({ detail }) => {
  showStream(detail?.stream ?? null, true);
  $('source').textContent = detail ? (detail.settings.displaySurface === 'monitor' ? 'Monitor' : 'Janela') + ' · prévia local sem som' : 'Nenhuma fonte selecionada';
  if (detail) {
    const s = detail.settings;
    status(`Captura real iniciada: ${s.width ?? '?'}×${s.height ?? '?'} · ${Math.round(s.frameRate ?? 0)} FPS. ${detail.audio ? (detail.audioMode === 'system' ? 'WASAPI ativo: todo o áudio do sistema, incluindo outros aplicativos.' : 'Faixa de áudio fornecida pelo seletor da janela.') : 'Sem faixa de áudio.'}`);
  }
  render();
});
rtc.addEventListener('remote', ({ detail }) => { if (state.role !== 'host') { showStream(detail); $('source').textContent = detail ? 'Recebendo transmissão' : 'Aguardando o criador'; } });
rtc.addEventListener('peerState', ({ detail }) => {
  const name = state.participants.find(p => p.id === detail.id)?.name ?? 'Participante';
  if (detail.state === 'connected') status(`Mídia WebRTC conectada com ${name}.`);
  if (detail.state === 'failed' || detail.state === 'disconnected') status(`Reconectando mídia com ${name}...`);
});
rtc.addEventListener('stats', ({ detail }) => {
  $('directStatus').textContent = detail.length && detail.every(row => row.direct) ? 'P2P direto confirmado · sem relay' : 'STUN gratuito · P2P não confirmado';
  if (!detail.length) { $('stats').className = 'stats-empty'; $('stats').textContent = 'As estatísticas aparecem quando houver uma conexão WebRTC.'; return; }
  $('stats').className = '';
  $('stats').replaceChildren(...detail.map(row => {
    const div = document.createElement('div'); div.className = 'peer-stat';
    const name = document.createElement('span'); name.className = 'stat-name'; name.textContent = state.participants.find(p => p.id === row.id)?.name ?? 'Participante';
    const values = document.createElement('div'); values.className = 'stat-values';
    const entries = [
      ['Taxa', row.bitrate === null ? '—' : row.bitrate.toFixed(2) + ' Mbps'], ['FPS', row.fps === null ? '—' : Math.round(row.fps)],
      ['Resolução', row.width ? `${row.width}×${row.height}` : '—'], ['RTT', row.rtt === null ? '—' : Math.round(row.rtt) + ' ms'],
      ['Perda', (row.loss * 100).toFixed(1) + '%'], ['Codec', row.codec], ['Rota', row.route], ['ICE local/remoto', row.localCandidate + ' / ' + row.remoteCandidate], ['Transporte', row.transport], ['Estado', row.state],
      ['Motor', row.hardware], ['Aceleração eficiente', row.powerEfficient === null ? 'Não informada' : row.powerEfficient ? 'Sim' : 'Não'],
      ['Áudio RTP', row.audioPackets === null ? 'Sem medição' : `${row.audioCodec?.replace('audio/', '') ?? 'Áudio'} · ${row.audioPackets} pacotes`],
      ['Limitação', row.limitation ?? '—']
    ];
    for (const [label, value] of entries) { const span = document.createElement('span'); const strong = document.createElement('strong'); strong.textContent = value; span.append(strong, document.createTextNode(label)); values.append(span); }
    div.append(name, values); return div;
  }));
});
function showExpiry(expiresAt) { $('roomCode').textContent = 'Sala ' + (state.roomId ?? '').slice(0, 8) + ' · válida até ' + new Date(expiresAt).toLocaleString('pt-BR') + ' · renovação pelo criador'; }
function showUpdate(result) {
  if (result.available) { $('updateText').textContent = `Nova versão oficial disponível: ${result.version}`; $('updateNotice').hidden = false; }
  else if (result.message) status(result.message);
}
$('create').addEventListener('click', () => busy(() => connect('create')));
$('join').addEventListener('click', () => busy(() => connect('join')));
$('copy').addEventListener('click', () => busy(async () => { await native('copy', { text: state.invitation }); status('Convite copiado. Compartilhe apenas com seus amigos.'); }));
$('paste').addEventListener('click', () => busy(async () => { $('invite').value = await native('paste'); }));
$('leave').addEventListener('click', () => busy(async () => { await rtc.leave(); await native('leave'); await disconnected('Você saiu da sala.'); }));
$('start').addEventListener('click', () => busy(() => rtc.startCapture(options())));
$('stop').addEventListener('click', () => busy(async () => { await rtc.stopCapture(); status('Captura e transmissão encerradas. A sala continua aberta.'); }));
$('play').addEventListener('click', async () => { try { await player.play(); $('play').hidden = true; } catch (error) { status(error.message, true); } });
$('volume').addEventListener('input', () => { player.volume = Number($('volume').value); });
$('fullscreen').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('playerCard').requestFullscreen(); } catch (error) { status(error.message, true); } });
$('updateButton').addEventListener('click', () => busy(async () => showUpdate(await native('checkUpdates'))));
$('installUpdate').addEventListener('click', () => busy(async () => { if (state.connected) throw Error('Saia da sala antes de instalar a atualização.'); await native('installUpdate'); }));
for (const id of ['autoQuality', 'upload']) $(id).addEventListener('change', () => { rtc.setOptions(options()); void save().catch(error => status(error.message, true)); });
for (const id of ['quality', 'fps']) $(id).addEventListener('change', () => {
  rtc.setOptions(options()); void save().catch(error => status(error.message, true));
  void rtc.requestQuality().catch(error => status(error.message, true));
});
$('audio').addEventListener('change', () => { $('audioHint').textContent = $('audio').value === 'system' ? 'WASAPI captura a saída padrão inteira: jogo, Discord, notificações e outros aplicativos. O microfone não é capturado diretamente.' : $('audio').value === 'none' ? 'Apenas vídeo. Nenhum áudio será transmitido.' : 'Escolha a janela do jogo e habilite áudio no seletor. A disponibilidade depende da versão do Windows e do WebView2.'; });
window.streamroom = { shutdown: async () => { state.shuttingDown = true; await rtc.shutdown(); }, diagnostics: () => ({ secureContext: isSecureContext, getDisplayMedia: typeof navigator.mediaDevices?.getDisplayMedia === 'function', webrtc: typeof RTCPeerConnection === 'function', audioWorklet: typeof AudioWorkletNode === 'function', peers: rtc.peers.size }) };
try {
  const response = await native('ready');
  for (const [key, value] of Object.entries(response.settings ?? {})) {
    const input = $(key); if (!input) continue;
    if (input.type === 'checkbox') input.checked = Boolean(value); else input.value = String(value);
  }
  $('version').textContent = response.version + ' · desenvolvimento'; $('runtime').textContent = 'Motor WebView2 ' + response.runtime;
  $('footerVersion').textContent = `StreamRoom ${response.version} · build de desenvolvimento`;
  if (!isSecureContext || !navigator.mediaDevices?.getDisplayMedia || !globalThis.RTCPeerConnection) status('O motor instalado não suporta captura/WebRTC. Atualize o Microsoft Edge WebView2 Runtime.', true);
  if (response.installed) setTimeout(() => { if (!state.connected) native('checkUpdates').then(result => { if (result.available) showUpdate(result); }).catch(() => {}); }, 5000);
} catch (error) { status('Falha ao iniciar: ' + error.message, true); }
render();
