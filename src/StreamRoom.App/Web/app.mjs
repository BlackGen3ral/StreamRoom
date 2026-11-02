import { RtcRoom } from './rtc-room.mjs';
import { createCapturePicker } from './capture-picker.mjs';
import { createZeroTierUi } from './zerotier-ui.mjs';
import { createStreamViewport } from './stream-viewport.mjs';
import { createProfileUi, showAvatar } from './profile-ui.mjs';
import { createFriendsUi } from './friends-ui.mjs';
import { createUiSounds, createViewerNotifications } from './ui-sounds.mjs';
const $ = id => document.getElementById(id);
$('transmissionPage').append($('settingsTransmission'));
$('connectionsPage').append($('settingsConnections'));
$('connectionsPage').append(document.querySelector('.support-row'));
$('settingsConnections').hidden = false;
for (const id of ['settingsTransmission','settingsConnections']) { $(id).removeAttribute('role'); $(id).removeAttribute('aria-labelledby'); }
let currentPage = 'screens';
function selectPage(page, focus = false) {
  currentPage = page;
  for (const tab of document.querySelectorAll('[data-page]')) {
    const active = tab.dataset.page === page;
    tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    $(tab.getAttribute('aria-controls')).hidden = !active;
    if (active && focus) tab.focus();
  }
}
const requests = new Map(); let sequence = 0;
function native(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = String(++sequence);
    const timer = setTimeout(() => { requests.delete(id); reject(Error('O aplicativo demorou para responder. Tente novamente.')); }, type === 'googleSignIn' ? 330000 : type === 'profilePhoto' ? 900000 : type === 'zeroTierDownload' ? 330000 : type === 'retireTailscale' ? 660000 : type === 'zeroTierJoin' ? 180000 : type === 'downloadUpdate' ? 900000 : type === 'checkUpdates' ? 120000 : type === 'connect' ? 45000 : 25000);
    requests.set(id, { resolve, reject, timer }); window.chrome.webview.postMessage({ id, type, payload });
  });
}
const rtc = new RtcRoom(native);
const state = { connected: false, role: null, persistent: false, groupSaved: false, groupInvalid: false, invitation: '', participants: [], room: null, busy: false, shuttingDown: false };
let updateBusy = false, updateReady = false;
let latestStats = [], buildVersion = '', runtimeVersion = '';
const cards = new Map(), remoteStreams = new Map();
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
const zeroTierUi = createZeroTierUi(native, rtc, () => state.connected, status);
const friendsUi = createFriendsUi(native, () => render());
const profileUi = createProfileUi(native, (profile, note) => {
  $('name').value = profile.name; uiSounds.refresh(); render();
  void save().catch(() => {}); status(note || (state.connected ? 'Perfil atualizado na sala.' : 'Perfil salvo neste PC.'));
});
const uiSounds = createUiSounds(() => profileUi.soundsEnabled);
const viewerSounds = createViewerNotifications(kind => uiSounds.play(kind));
function options() { return { quality: Number($('quality').value), fps: Number($('fps').value), audio: $('audio').value, autoQuality: $('autoQuality').checked, upload: Number($('upload').value) }; }
function node(tag, className, text) { const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; }
function button(text, action) { const e = node('button', 'quiet', text); e.addEventListener('click', action); return e; }
function openSettings(tab = 'transmission') {
  $('settings').open = true;
  selectPage(tab, true);
}
function quality(card) { const [height, fps] = card.quality.value.split(':').map(Number); return { height, fps }; }
function createCard(id, streamId) {
  const own = id === rtc.identity?.participantId, card = { id, streamId, own };
  card.root = node('section', 'stream-card card'); card.root.dataset.publisher = id;
  const heading = node('div', 'section-title stream-heading');
  const identity = node('div', 'stream-identity'); card.avatar = node('span', 'stream-avatar'); card.avatar.setAttribute('aria-hidden', 'true');
  const labels = node('div'); card.title = node('h2'); labels.append(card.title, node('span', 'stream-caption', own ? 'Sua tela · prévia sem som' : 'Tela compartilhada'));
  identity.append(card.avatar, labels); heading.append(identity, node('span', 'live-indicator', 'AO VIVO'));
  card.frame = node('div', 'player-card'); card.video = node('video'); card.video.autoplay = true; card.video.playsInline = true; card.video.muted = true;
  card.empty = node('p', 'stream-placeholder', own ? 'Prévia local sem som' : 'Escolha Assistir para receber esta gameplay.');
  card.play = button('▶ Reproduzir', async () => { try { await card.video.play(); card.play.hidden = true; } catch (e) { status(e.message, true); } }); card.play.className = 'overlay-play'; card.play.hidden = true;
  card.video.addEventListener('loadeddata', () => { card.empty.hidden = true; });
  card.video.addEventListener('emptied', () => { card.empty.hidden = false; });
  card.frame.append(card.video, card.empty, card.play);
  const controls = node('div', 'stream-controls');
  card.watch = button(own ? 'Parar minha transmissão' : 'Assistir', () => busy(async () => {
    if (own) { await rtc.stopCapture(); status('Sua transmissão parou. As demais continuam.'); return; }
    card.failure = null;
    const watching = rtc.subscriptions.some(s => s.publisherId === id);
    await rtc.watch(id, !watching, quality(card).height, quality(card).fps);
  }));
  card.retry = button('Reconectar', () => busy(async () => { card.failure = null; await rtc.watch(id, true, quality(card).height, quality(card).fps, true); }));
  card.retry.hidden = true;
  card.quality = node('select'); card.quality.setAttribute('aria-label', 'Qualidade de ' + id);
  for (const [value, label] of [['480:30','480p · 30 FPS'],['720:30','720p · 30 FPS'],['720:60','720p · 60 FPS'],['1080:30','1080p · 30 FPS'],['1080:60','1080p · 60 FPS']]) {
    const option = node('option', '', label); option.value = value; card.quality.append(option);
  }
  card.quality.hidden = own;
  card.quality.value = '1080:60';
  card.quality.addEventListener('change', () => busy(async () => { if (rtc.subscriptions.some(s => s.publisherId === id)) await rtc.watch(id, true, quality(card).height, quality(card).fps); }));
  card.mute = button('Ativar som', async () => { card.video.muted = !card.video.muted; card.mute.textContent = card.video.muted ? 'Ativar som' : 'Silenciar'; });
  card.mute.hidden = own;
  card.sendMute = button('Silenciar live', () => { try { rtc.setCaptureAudioMuted(!rtc.captureAudioMuted); } catch(error) { status(error.message,true); } });
  card.sendMute.classList.add('stream-audio');card.sendMute.hidden = !own;
  card.volume = node('input'); card.volume.type = 'range'; card.volume.min = '0'; card.volume.max = '1'; card.volume.step = '.01'; card.volume.value = '.8'; card.video.volume = .8; card.volume.hidden = own;
  card.volume.setAttribute('aria-label', 'Volume desta transmissão');
  card.volume.addEventListener('input', () => { card.video.volume = Number(card.volume.value); card.video.muted = card.video.volume === 0; card.mute.textContent = card.video.muted ? 'Ativar som' : 'Silenciar'; });
  const enlarge = button('Destacar', () => {
    const focused = !card.root.classList.contains('expanded');
    for (const other of cards.values()) { other.root.classList.remove('expanded'); other.enlarge.textContent = 'Destacar'; other.enlarge.setAttribute('aria-pressed', 'false'); }
    card.root.classList.toggle('expanded', focused); enlarge.textContent = focused ? 'Voltar à grade' : 'Destacar'; enlarge.setAttribute('aria-pressed', String(focused));
    $('streamGrid').classList.toggle('has-highlight', focused);
    if (focused && $('streamGrid').children.length>1) card.root.scrollIntoView({ block: 'start', behavior: 'instant' });
  });
  card.enlarge = enlarge; enlarge.setAttribute('aria-pressed', 'false');
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
  const more = node('details', 'stream-more');
  const moreButton = node('summary', '', 'Opções'); moreButton.setAttribute('aria-label','Mais opções e tamanho do vídeo'); more.append(moreButton);
  const extra = node('div', 'stream-extra'); extra.append(card.pause); more.append(extra);
  card.watch.classList.add('stream-action'); if (own) card.watch.classList.add('stream-stop');
  fullscreen.classList.add('stream-fullscreen'); enlarge.classList.add('stream-enlarge');
  card.retry.classList.add('stream-retry');card.mute.classList.add('stream-audio');
  const primaryActions=node('div','stream-primary-actions'),playbackActions=node('div','stream-playback-actions'),viewActions=node('div','stream-view-actions');
  primaryActions.append(card.watch,card.retry,card.sendMute);playbackActions.append(card.quality,card.mute,card.volume);viewActions.append(enlarge,fit,fullscreen,more);
  playbackActions.hidden=own;controls.append(primaryActions,playbackActions,viewActions);
  card.metrics = node('p', 'fine', own ? 'Prévia local · aguardando espectadores' : 'Clique em Assistir para abrir esta tela.');
  card.root.append(heading, card.frame, controls, card.metrics); cards.set(id, card); $('streamGrid').append(card.root);
  card.viewport = createStreamViewport(card.root, card.frame, fullscreen, more, extra);
  return card;
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
    card.viewport.dispose(); card.video.pause(); card.video.srcObject = null; card.root.remove(); cards.delete(id); remoteStreams.delete(id);
  }
  for (const p of streams) {
    const card = cards.get(p.id) ?? createCard(p.id, p.streamId);
    const watched = rtc.subscriptions.some(s => s.publisherId === p.id && s.streamId === p.streamId);
    card.title.textContent = p.name + (card.own ? ' · você' : '');
    showAvatar(card.avatar, p.name, card.own ? profileUi.avatar : p.avatar);
    card.quality.setAttribute('aria-label', 'Qualidade de ' + p.name);
    const stream = card.own ? rtc.localStream : watched && remoteStreams.get(p.id)?.streamId === p.streamId ? remoteStreams.get(p.id).stream : null;
    if (card.video.srcObject !== stream) {
      card.video.srcObject = stream; card.play.hidden = true;
      if (stream) card.video.play().catch(() => { card.play.hidden = card.video.srcObject !== stream || Boolean(card.failure); });
    }
    card.empty.hidden = !card.failure && Boolean(stream && card.video.readyState >= 2 && card.video.videoWidth > 0);
    if (card.failure) card.play.hidden = true;
    card.empty.textContent = card.own ? 'Prévia local sem som' : card.failure ? card.failure : watched ? 'Conectando com seu amigo… O vídeo aparece quando a conexão estiver pronta.' : 'Escolha Assistir para receber esta gameplay.';
    card.watch.textContent = card.own ? 'Parar transmissão' : watched ? 'Parar de assistir' : 'Assistir';
    card.retry.hidden = card.own || !watched; card.retry.disabled = state.busy;
    card.watch.disabled = state.busy; card.quality.disabled = state.busy;
    card.mute.disabled = card.volume.disabled = card.pause.disabled = !stream;
    if(card.own) {
      const audio = Boolean(rtc.localStream?.getAudioTracks().length);
      card.sendMute.disabled = !audio; card.sendMute.textContent = !audio ? 'Sem áudio' : rtc.captureAudioMuted ? 'Ativar áudio' : 'Silenciar live';
      card.sendMute.setAttribute('aria-pressed',String(Boolean(rtc.captureAudioMuted)));
    }
    if (!watched && !card.own) card.metrics.textContent = 'Sem recepção: nenhum vídeo é solicitado.';
  }
  $('streamGrid').hidden = streams.length === 0; $('playerEmpty').hidden = streams.length !== 0;
  $('streamCount').textContent = streams.length + ' ao vivo';
  document.body.classList.toggle('has-streams', streams.length > 0);
  const launcher = document.querySelector('.capture-launch'), target = streams.length ? $('transmissionPage') : $('screensPage');
  if (launcher.parentElement !== target) target.insertBefore(launcher, streams.length ? $('settingsTransmission') : $('streamGrid'));
  $('stageShare').hidden = !streams.length || Boolean(rtc.localStream);
  $('stageShare').disabled = state.busy || !state.connected;
  $('streamGrid').classList.toggle('has-highlight', [...cards.values()].some(card => card.root.classList.contains('expanded')));
  for (const card of cards.values()) card.viewport.sync();
}
function renderProfile() {
  const name = $('name').value.trim() || 'Você';
  $('profileName').textContent = name;
  showAvatar($('profileAvatar'), name, profileUi.avatar);
  $('profileStatus').textContent = rtc.localStream ? 'Compartilhando tela' : state.connected ? 'Conectado à sala' : 'Pronto para entrar';
}
function render() {
  renderProfile();
  $('qualitySummary').textContent = $('quality').value + 'p · ' + $('fps').value + ' FPS';
  $('qualitySummaryHint').textContent = rtc.localStream ? 'Compartilhando · ajustes aplicados ao vivo' : 'Pronto para sua próxima transmissão';
  $('headerRoom').textContent = state.connected ? 'Sala conectada' : 'Sua sala';
  document.body.classList.toggle('in-room', state.connected);
  $('installUpdate').disabled = !updateReady || state.connected;
  if (updateReady) $('installUpdate').textContent = state.connected ? 'Saia da sala para atualizar' : 'Reiniciar e atualizar';
  $('entryControls').hidden = state.connected; $('roomControls').hidden = !state.connected;
  $('create').disabled = $('join').disabled = $('paste').disabled = state.busy;
  for (const id of ['createGroup','enterGroup','forgetGroup','deleteGroup']) $(id).disabled = state.busy;
  $('createGroup').hidden = state.groupSaved || state.groupInvalid;
  $('enterGroup').hidden = !state.groupSaved;
  $('forgetGroup').hidden = !state.groupSaved && !state.groupInvalid;
  $('groupHint').textContent = state.groupInvalid ? 'Não foi possível ler o acesso salvo. Remova-o para entrar novamente com um convite.' : state.groupSaved ? 'Seu acesso está salvo neste PC. Entre quando quiser, mesmo se o criador estiver offline.' : 'Compartilhe o convite uma vez. O acesso fica salvo no app de cada amigo.';
  $('groupManagement').hidden = !state.connected || !state.persistent || state.role !== 'host';
  $('leave').disabled = state.busy; $('name').disabled = state.connected || state.busy; $('server').disabled = state.connected || state.busy;
  $('start').disabled = !state.connected || state.busy || Boolean(rtc.localStream);
  $('startCompatible').hidden = Boolean(rtc.localStream);
  $('startCompatible').disabled = !state.connected || state.busy;
  $('captureSetup').hidden = Boolean(rtc.localStream);
  if (!rtc.localStream) $('source').textContent = state.connected ? 'Você confirma a fonte no seletor.' : 'Entre em uma sala para começar.';
  $('start').hidden = Boolean(rtc.localStream); $('stop').hidden = true; $('stop').disabled = state.busy;
  document.body.classList.toggle('is-sharing', Boolean(rtc.localStream));
  for (const id of ['quality', 'fps', 'autoQuality', 'upload']) $(id).disabled = state.busy;
  $('audio').disabled = Boolean(rtc.localStream);
  $('liveQualityHint').textContent = rtc.localStream ? 'Alterações de resolução e FPS são aplicadas à transmissão em andamento. Áudio pode ser alterado na próxima captura.' : 'Padrão: 1080p a 60 FPS. A qualidade real depende da fonte, da conexão e do PC.';
  $('showTransmissionSettings').textContent = $('quality').value + 'p · ' + $('fps').value + ' FPS';
  $('networkBadge').textContent = state.connected ? 'Sala conectada' : 'Desconectado'; $('networkBadge').classList.toggle('connected', state.connected);
  $('participantCount').textContent = state.participants.length + '/5'; $('emptyPeers').hidden = state.participants.length > 0;
  $('leave').textContent = state.role === 'host' && !state.persistent ? 'Encerrar sala para todos' : 'Sair da sala';
  $('roomState').textContent = 'TELA COMPARTILHADA';
  $('title').textContent = 'Transmissões';
  $('emptyTitle').textContent = state.connected ? 'Sua sala está pronta.' : 'Nenhuma transmissão';
  $('emptyDescription').textContent = state.connected ? 'Compartilhe sua tela ou escolha uma transmissão para assistir.' : 'Crie uma sala ou entre com um convite.';
  friendsUi.update(state.participants, rtc.identity?.participantId);
  $('participants').replaceChildren(...state.participants.map(p => {
    const li = node('li','participant-item'), details = node('div','participant-copy');
    const self = p.id === rtc.identity?.participantId;
    details.append(node('div','peer-name',p.name + (self ? ' (você)' : '')), node('div','peer-role',p.streamId ? 'Compartilhando tela' : p.role === 'host' ? 'Criador da sala' : 'Na sala'));
    const avatar = node('span','avatar'); showAvatar(avatar, p.name, self ? profileUi.avatar : p.avatar);
    const presence = node('span','peer-presence'); presence.classList.toggle('streaming', Boolean(p.streamId)); presence.title = p.streamId ? 'Compartilhando tela' : 'Conectado';
    li.append(avatar,details,presence);
    if (!self) li.append(friendsUi.actionFor(p));
    return li;
  }));
  renderStreams();
}
async function busy(action) {
  if (state.busy) return; state.busy = true; render();
  try { await action(); } catch (e) { status(e.name === 'NotAllowedError' ? 'Compartilhamento cancelado ou não autorizado. Escolha uma fonte quando quiser.' : e.message, e.name !== 'NotAllowedError'); }
  finally { state.busy = false; render(); }
}
async function save() { await native('settings', { server: $('server').value.trim(), name: $('name').value.trim(), qualityDefaults: 2, tailscaleEnabled: false, ...options() }); }
async function refreshGroup() {
  try { const group = await native('groupRoomStatus'); state.groupSaved = group.saved; state.groupInvalid = false; }
  catch { state.groupSaved = false; state.groupInvalid = true; }
  render();
}
async function connect(mode) {
  state.participants = []; state.room = null; await save();
  status(mode === 'create' || mode === 'createFixed' ? 'Criando sala...' : 'Entrando na sala...');
  const response = await native('connect', { mode, server: $('server').value.trim(), name: $('name').value.trim(), invite: $('invite').value.trim() });
  if (response.server) $('server').value = response.server;
  state.connected = true; state.role = response.welcome.role; state.invitation = response.invitation; state.roomId = response.welcome.roomId;
  state.persistent = Boolean(response.welcome.persistent);
  selectPage('screens');
  rtc.setOptions(options()); rtc.enter(response.welcome); if (state.room) rtc.updateRoom(state.room);
  showExpiry(response.welcome.expiresAt); $('invite').value = '';
  void save().catch(() => status('Sala conectada. Não foi possível salvar o endereço para a próxima sessão.', true));
  await refreshGroup();
  status(state.persistent ? 'Sala do grupo conectada. O acesso está salvo para a próxima vez.' : 'Sala pronta. Você pode transmitir e escolher quais gameplays assistir.'); void rtc.ice().catch(e => status(e.message, true));
}
async function disconnected(message) {
  if (state.shuttingDown) return;
  state.connected = false; state.role = null; state.persistent = false; state.invitation = ''; state.participants = []; state.room = null;
  viewerSounds.reset();
  await rtc.leave(); remoteStreams.clear(); $('source').textContent = 'Nenhuma fonte selecionada'; status(message); render();
}
window.chrome.webview.addEventListener('message', ({ data }) => {
  if (data.type === 'reply') {
    const r = requests.get(data.id); if (!r) return; requests.delete(data.id); clearTimeout(r.timer); data.ok ? r.resolve(data.result) : r.reject(Error(data.error));
  } else if (data.type === 'roomState') { state.room = data.state; state.participants = data.state.participants; if (rtc.identity) rtc.updateRoom(data.state); if (rtc.localStream) viewerSounds.update(data.state.subscribers ?? []); else viewerSounds.reset(); render(); }
  else if (data.type === 'signal') rtc.enqueueSignal(data.from, data.payload);
  else if (data.type === 'disconnected') void disconnected(data.message);
  else if (data.type === 'serverError' || data.type === 'audioError') status(data.message, true);
  else if (data.type === 'nativeCaptureEnded') { if (rtc.nativeBridge?.session === data.session) { status(data.message, true); void rtc.stopCapture(); } }
  else if (data.type === 'nativeCaptureDelayed' && rtc.nativeBridge?.session === data.session) status('Aguardando a retomada da ponte de vídeo…');
  else if (data.type === 'nativeCaptureResumed' && rtc.nativeBridge?.session === data.session) status('Vídeo retomado.');
  else if (data.type === 'pcm') rtc.pushPcm(data.data);
  else if (data.type === 'roomRenewed') showExpiry(data.expiresAt);
  else if (data.type === 'update') showUpdate(data.result);
  else if (data.type === 'updateProgress') { $('updateText').textContent = 'Baixando arquivos · ' + data.progress + '%'; $('updateDownloadProgress').value = data.progress; }
});
rtc.addEventListener('notice', e => status(e.detail));
rtc.addEventListener('connectionError', ({ detail }) => {
  const name = state.participants.find(p => p.id === detail.id)?.name ?? 'Participante';
  const card = cards.get(detail.id);
  if (card && !card.own) { card.failure = detail.message; card.play.hidden = true; card.empty.hidden = false; card.empty.textContent = detail.message; card.metrics.textContent = 'Conexão não estabelecida. Use Reconectar para tentar novamente.'; }
  status(name + ': ' + detail.message + ' Use Reconectar na transmissão para tentar novamente.', true);
});
rtc.addEventListener('capture', ({ detail }) => {
  viewerSounds.capture(detail ? rtc.localId : null);
  $('source').textContent = detail ? 'Compartilhando: ' + (detail.source || 'fonte selecionada') + ' · prévia sem som' : 'Nenhuma fonte selecionada';
  if (detail) status('Captura real iniciada: ' + detail.settings.width + '×' + detail.settings.height + '. Vídeo é enviado somente a quem escolher assistir. ' + (detail.audio ? 'Faixa de áudio ativa.' : 'Sem faixa de áudio.'));
  render();
});
rtc.addEventListener('captureAudio', () => renderStreams());
rtc.addEventListener('remote', ({ detail }) => {
  if (detail.stream) remoteStreams.set(detail.id, detail);
  else if (remoteStreams.get(detail.id)?.streamId === detail.streamId) remoteStreams.delete(detail.id);
  renderStreams();
});
rtc.addEventListener('peerState', ({ detail }) => {
  if (detail.state === 'failed' || detail.state === 'disconnected') status('Reconectando uma transmissão; as outras continuam.');
});
function renderStats(detail) {
  $('stats').replaceChildren(...detail.map(row => {
    const name = state.participants.find(p => p.id === row.id)?.name ?? 'Participante';
    if (row.failed) return node('p', 'fine', 'Última tentativa com ' + name + ': conexão direta falhou · ICE: ' + row.iceState + ' · descoberta: ' + row.gathering + ' · endereços locais/públicos encontrados: ' + row.candidates.host + '/' + row.candidates.srflx + ' · endereços recebidos do amigo: ' + row.remoteCandidates + ' (públicos: ' + row.remotePublicCandidates + ') · negociação recebida: ' + (row.descriptionReceived ? 'sim' : 'não') + (row.stunError ? ' · houve falha ao consultar STUN' : '') + '. Esses dados permanecem até reconectar ou sair da sala.');
    const text = (row.direction === 'send' ? 'Enviando para ' : 'Recebendo de ') + name + ' · ' + (row.width ? row.width + '×' + row.height : '—') + ' · ' + (row.fps === null ? '—' : Math.round(row.fps)) + ' FPS · ' + (row.bitrate === null ? '—' : row.bitrate.toFixed(2)) + ' Mbps · ' + row.codec + ' · ' + row.route + ' · ICE ' + row.localCandidate + '/' + row.remoteCandidate + ' · ' + row.transport + ' · perda ' + (row.loss * 100).toFixed(1) + '% · RTT ' + (row.rtt === null ? '—' : Math.round(row.rtt) + ' ms') + ' · ' + row.hardware + ' · ICE: ' + (row.iceState ?? row.state) + ' · descoberta: ' + (row.gathering ?? '—') + ' · endereços locais/públicos: ' + (row.candidates?.host ?? 0) + '/' + (row.candidates?.srflx ?? 0) + (row.stunError ? ' · houve falha ao consultar STUN' : '');
    return node('p','fine',text);
  }));
  if (!detail.length) $('stats').textContent = 'Sem conexões de mídia. Escolha uma transmissão para assistir.';
}
$('stats').closest('details').addEventListener('toggle', event => { if (event.target.open) renderStats(latestStats); });
rtc.addEventListener('stats', ({ detail }) => {
  latestStats = detail;
  $('directStatus').textContent = rtc.zeroTierProof ? detail.some(r => r.zeroTier) ? 'ZeroTier · interface de mídia confirmada' : 'ZeroTier · aguardando mídia' : detail.some(r => r.overlayRelay) ? 'Tailscale · relay em uso' : detail.some(r => r.tailscale) ? 'Rede privada Tailscale' : detail.length && detail.every(r => r.direct) ? 'P2P direto confirmado · sem relay' : 'STUN gratuito · aguardando P2P';
  if ($('stats').closest('details').open) renderStats(detail);
  for (const card of cards.values()) {
    const rows = detail.filter(r => r.publisherId === card.id);
    if (!card.own && rows.length) {
      const row = rows[0];
      if (row.failed) { card.play.hidden = true; card.empty.hidden = false; card.empty.textContent = row.message; card.metrics.textContent = 'Conexão direta falhou. O diagnóstico foi preservado em Detalhes da conexão.'; continue; }
      if (row.state !== 'connected') {
        const message = row.elapsed >= 15
          ? 'A conexão está demorando. Tentando uma rota direta entre as redes…'
          : 'Conectando com seu amigo…';
        card.empty.hidden = false; card.empty.textContent = card.failure || message;
        card.metrics.textContent = message + ' · ' + row.elapsed + ' s';
        continue;
      }
      if (!row.frames) { card.empty.hidden = false; card.empty.textContent = 'Conexão estabelecida. Aguardando o primeiro frame de vídeo…'; }
    }
    card.metrics.textContent = card.own ? rtc.subscribers.length ? rtc.subscribers.length + (rtc.subscribers.length===1 ? ' pessoa selecionou sua tela' : ' pessoas selecionaram sua tela') + (rows.length ? ' · '+ rows.reduce((sum,r)=>sum+(r.bitrate??0),0).toFixed(2) + ' Mbps' : '') : 'Prévia local · aguardando espectadores'
      : rows.length ? (rows[0].width ?? '—') + '×' + (rows[0].height ?? '—') + ' · ' + (rows[0].fps === null ? '—' : Math.round(rows[0].fps)) + ' FPS · ' + rows[0].route : 'Sem recepção ativa.';
  }
});
function showExpiry(expiresAt) {
  $('roomCode').textContent = state.persistent ? 'Sala do grupo' : 'Sala ' + (state.roomId ?? '').slice(0,8);
  if (state.persistent) {
    $('roomCode').title = 'Sala fixa privada';
    $('roomLifetime').textContent = 'Acesso salvo neste PC';
    $('roomLifetime').title = 'Volte quando quiser, mesmo com a sala vazia.';
    return;
  }
  $('roomCode').title = 'Próxima renovação antes de ' + new Date(expiresAt).toLocaleString('pt-BR');
  $('roomLifetime').textContent = state.role === 'host' ? 'Renovação automática enquanto você estiver conectado. Sem limite total de duração.' : 'A sala continua ativa enquanto o criador estiver conectado.';
}
function showUpdate(r) {
  if (!r.available) { if (r.message) status(r.message); return; }
  $('updateNotice').hidden = false;
  $('updateHeading').textContent = r.version ? 'StreamRoom ' + r.version : 'Atualização do StreamRoom';
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
$('showStage').addEventListener('click', () => { selectPage('screens', true); $('stage').scrollIntoView({ block: 'start' }); });
$('stageShare').addEventListener('click', () => $('start').click());
for (const tab of document.querySelectorAll('[data-page]')) {
  tab.addEventListener('click', () => { if (tab.dataset.page === 'screens') selectPage('screens'); else openSettings(tab.dataset.page); });
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
    event.preventDefault(); const pages = ['screens','transmission','connections'];
    const index = pages.indexOf(currentPage);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + ((event.key === 'ArrowRight' || event.key === 'ArrowDown') ? 1 : 2)) % 3;
    if (pages[next] !== 'screens') $('settings').open = true;
    selectPage(pages[next], true);
  });
}
$('showSettings').addEventListener('click', () => openSettings());
$('showConnections').addEventListener('click', () => openSettings('connections'));
$('showTransmissionSettings').addEventListener('click', () => openSettings());
$('closeSettings').addEventListener('click', () => $('appSettingsDialog').close());
for (const button of document.querySelectorAll('[data-settings-tab]')) {
  button.addEventListener('click', () => openSettings(button.dataset.settingsTab));
  button.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault(); openSettings(event.key === 'Home' ? 'transmission' : event.key === 'End' ? 'connections' : button.dataset.settingsTab === 'transmission' ? 'connections' : 'transmission');
  });
}
$('create').addEventListener('click', () => busy(() => connect('create')));
$('createGroup').addEventListener('click', () => busy(() => connect('createFixed')));
$('enterGroup').addEventListener('click', () => busy(() => connect('saved')));
$('forgetGroup').addEventListener('click', () => busy(async () => { await native('groupRoomForget'); await refreshGroup(); }));
$('deleteGroup').addEventListener('click', () => busy(async () => {
  const result = await native('groupRoomDestroy');
  if (result?.deleted) { await disconnected('Sala excluída. Os acessos antigos não funcionam mais.'); await refreshGroup(); }
}));
$('join').addEventListener('click', () => busy(() => connect('join')));
$('copy').addEventListener('click', () => busy(async () => { await native('copy',{text:state.invitation}); status('Convite copiado.'); }));
$('paste').addEventListener('click', () => busy(async () => { $('invite').value = await native('paste'); }));
$('leave').addEventListener('click', () => busy(async () => { await rtc.leave(); await native('leave'); await disconnected('Você saiu da sala.'); }));
const capturePicker = createCapturePicker(native, rtc, options, status);
$('start').addEventListener('click', () => capturePicker.open());
$('startCompatible').addEventListener('click', () => busy(() => rtc.startCapture(options())));
$('stop').addEventListener('click', () => busy(async () => { await rtc.stopCapture(); status('Sua transmissão parou. As demais continuam.'); }));
$('updateButton').addEventListener('click', checkUpdates);
$('installUpdate').addEventListener('click', () => busy(async () => {
  if (state.connected) throw Error('Saia da sala antes de atualizar.');
  $('updateApplying').showModal();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  try { await native('installUpdate'); } catch (error) { $('updateApplying').close(); throw error; }
}));
$('updateApplying').addEventListener('cancel', event => event.preventDefault());
$('dismissMaintenance').addEventListener('click', () => { $('maintenanceNotice').hidden = true; });
for (const id of ['quality','fps','autoQuality','upload']) $(id).addEventListener('change', () => busy(async () => {
  try {
    await rtc.changeOptions(options()); await save();
    status(rtc.localStream ? 'Qualidade alterada para ' + $('quality').value + 'p · ' + $('fps').value + ' FPS, sem parar a transmissão.' : 'Preferências de transmissão salvas.');
  } catch (error) {
    $('quality').value = String(rtc.config.height); $('fps').value = String(rtc.config.fps);
    $('autoQuality').checked = rtc.automatic; $('upload').value = String(rtc.config.upload / 1e6);
    throw error;
  }
}));
$('audio').addEventListener('change', () => { $('audioHint').textContent = $('audio').value === 'system' ? 'WASAPI captura todo o sistema, incluindo Discord e outras gameplays que você estiver ouvindo. Pode causar retorno. Prefira áudio da janela.' : $('audio').value === 'none' ? 'Apenas vídeo.' : 'Escolha a janela do jogo e habilite áudio no seletor. Depende do Windows/WebView2.'; });
window.streamroom = { shutdown: async () => { state.shuttingDown = true; await rtc.shutdown(); }, diagnostics: () => ({ peers: rtc.peers.size, sending: rtc.subscribers.length, watching: rtc.subscriptions.length }) };
window.streamroom.shutdown = async () => { zeroTierUi.dispose(); uiSounds.dispose(); viewerSounds.reset(); state.shuttingDown = true; await rtc.shutdown(); };
window.addEventListener('pagehide', () => { zeroTierUi.dispose(); uiSounds.dispose(); }, { once: true });
$('copyDiagnostics').addEventListener('click', () => busy(async () => {
  // Whitelist only summary fields. No invites, IPs, account names, SDP, or keys.
  const fields = ['direction','state','failed','message','bitrate','fps','width','height','loss','rtt','codec','route','localCandidate','remoteCandidate','transport','direct','tailscale','overlayRelay','tailscaleAttempted','tailscaleCandidates','elapsed','iceState','gathering','candidates','stunError','frames','remoteCandidates','remotePublicCandidates','descriptionReceived'];
  fields.push('zeroTier','overlayRoute');
  const report = { format: 1, version: buildVersion, runtime: runtimeVersion, at: new Date().toISOString(), zeroTier: { ...zeroTierUi.diagnostics(), verifiedMediaConnections: latestStats.filter(row => row.zeroTier).length }, tailscale: { retired: true },
    connections: latestStats.map(row => Object.fromEntries(fields.filter(key => row[key] !== undefined).map(key => [key,row[key]]))) };
  await native('copy', { text: JSON.stringify(report, null, 2) }); status('Diagnóstico copiado, sem convites, IPs ou tokens.');
}));
try {
  const r = await native('ready');
  await refreshGroup();
  await zeroTierUi.start(r);
  for (const [key,value] of Object.entries(r.settings ?? {})) { const input=$(key); if (!input) continue; if(input.type==='checkbox') input.checked=Boolean(value); else input.value=String(value); }
  profileUi.start(r.profile, r.google, Boolean(r.clientConfiguration?.googleClientId));
  await friendsUi.start();
  if (r.settings?.qualityDefaults !== 2) { $('quality').value = '1080'; $('fps').value = '60'; }
  rtc.setOptions(options());
  if (!r.uiPreview) void save().catch(() => {});
  buildVersion = r.version; runtimeVersion = r.runtime;
  $('version').textContent=r.version+(r.installed?'':' · desenvolvimento'); $('runtime').textContent='Motor WebView2 '+r.runtime; $('footerVersion').textContent='StreamRoom '+r.version+(r.installed?'':' · build de desenvolvimento');
  if (!isSecureContext || !navigator.mediaDevices?.getDisplayMedia || !globalThis.RTCPeerConnection) status('Atualize o Microsoft Edge WebView2 Runtime para captura/WebRTC.',true);
  if (r.playerLayoutTest) {
    const { runPlayerLayoutTest } = await import('./player-layout-test.mjs');
    void runPlayerLayoutTest({ native, rtc, state, render, showExpiry, profileUi });
  } else if (r.uiPreview) {
    const preview = new URLSearchParams(location.search).get('preview');
    if (preview === 'settings') openSettings();
    if (preview === 'connections') openSettings('connections');
    setTimeout(() => native('uiPreview'), 2000);
  }
  if (r.capturePreview) { capturePicker.open(); setTimeout(() => native('capturePreview'), 6000); }
  if(r.installed) setTimeout(checkUpdates,5000);
  if (r.installed && !r.uiPreview) {
    const outcome = await native('updateOutcome');
    if (outcome?.message) status(outcome.message);
    setTimeout(async () => {
      try { const result = await native('retireTailscale'); if (result?.message) { $('maintenanceText').textContent = result.message; $('maintenanceNotice').hidden = false; } }
      catch (error) { $('maintenanceText').textContent = 'Tailscale: ' + error.message; $('maintenanceNotice').hidden = false; }
    }, 2000);
  }
} catch(e) {status('Falha ao iniciar: '+e.message,true);}
render();
