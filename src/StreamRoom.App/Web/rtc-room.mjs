import { directConfiguration, directRoute, DIRECT_FAILURE } from './direct-ice.mjs';
import { profile, perPeerCap, adapt } from './quality.mjs';
import { localTailCandidate, tailDescription, tailscaleRoute, deferTailCandidate } from './tailscale-routing.mjs';
import { zeroTierCandidate, zeroTierRoute } from './zerotier-routing.mjs';
import { CameraShare } from './camera-share.mjs';

export class RtcRoom extends EventTarget {
  constructor(native) {
    super(); this.native = native; this.peers = new Map(); this.creating = new Set(); this.attempts = new Map(); this.failedConnections = new Map();
    this.camera=new CameraShare(this);
    this.participants = []; this.pending = []; this.identity = null; this.localStream = null; this.run = 0; this.subscriptions = []; this.subscribers = []; this.localId = null;
    this.config = profile(); this.automatic = true; this.statsBusy = false;
    this.timer = setInterval(() => this.measure().catch(error => this.notice(error.message)), 2000);
  }
  event(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  get cameraStream(){return this.camera.stream;}
  setCamera(active){return active?this.camera.start():this.camera.stop();}
  notice(message) { this.event('notice', message); }
  setTailscale(snapshot, enabled) {
    this.tailscale = snapshot; this.tailscaleEnabled = Boolean(enabled);
    if (snapshot?.addresses?.length) this.tailscaleKnown = snapshot;
  }
  enter(welcome) {
    this.identity = welcome;
    const pending = this.pending.splice(0);
    for (const signal of pending) this.enqueueSignal(signal.from, signal.payload);
  }
  async ice() {
    if (this.zeroTierProof && !this.zeroTier?.connected) throw Error('ZeroTier experimental: conecte e autorize os dois dispositivos na rede privada antes de transmitir.');
    if (!this.iceCache || Date.now() - this.iceAt > 300_000) {
      if (!this.iceRequest) this.iceRequest = this.native('ice').then(value => { this.iceCache = value; this.iceAt = Date.now(); this.event('ice', 'direct-only'); }).finally(() => { this.iceRequest = null; });
      await this.iceRequest;
    }
    const configuration = directConfiguration(this.iceCache);
    return this.zeroTierProof ? { ...configuration, iceServers: [] } : configuration;
  }
  updateRoom(state) {
    this.participants = state.participants ?? [];
    this.subscriptions = state.subscriptions ?? [];
    this.subscribers = state.subscribers ?? [];
    const valid = new Set([...this.subscriptions, ...this.subscribers].map(s => s.subscriptionId));
    for (const [key, peer] of this.peers) if (!valid.has(key) || !this.validPeer(peer)) this.closePeer(key);
    for (const key of this.failedConnections.keys()) if (!valid.has(key)) this.failedConnections.delete(key);
    for (const key of this.attempts.keys()) if (!valid.has(key)) this.attempts.delete(key);
    this.ensureViewers();
    this.event('selections', state);
  }
  validPeer(peer) {
    if (this.peers.get(peer.key) !== peer || !this.identity) return false;
    return peer.direction === 'send'
      ? Boolean(this.localStream && this.localId === peer.streamId && this.subscribers.some(s => s.subscriptionId === peer.key && s.viewerId === peer.id && s.streamId === peer.streamId))
      : this.subscriptions.some(s => s.subscriptionId === peer.key && s.publisherId === peer.id && s.streamId === peer.streamId);
  }
  async watch(publisherId, active, height = 480, fps = 30, restart = false) {
    const publisher = this.participants.find(p => p.id === publisherId);
    if (!this.identity || publisherId === this.identity.participantId || !publisher?.streamId) throw Error('Transmissão indisponível.');
    const previous = this.subscriptions.find(s => s.publisherId === publisherId);
    const subscriptionId = active ? (!restart && previous?.subscriptionId) || crypto.randomUUID() : previous?.subscriptionId;
    if (!subscriptionId) return;
    if (!active) this.closePeer(subscriptionId);
    if (active && restart && previous) this.closePeer(previous.subscriptionId);
    await this.native('watch', { publisherId, streamId: publisher.streamId, subscriptionId, active, height, fps });
  }
  setOptions(options) {
    this.config = profile(options.quality, options.fps, options.upload);
    this.automatic = options.autoQuality;
  }
  changeOptions(options) {
    const apply = async () => {
      const config = profile(options.quality, options.fps, options.upload);
      const stream = this.localStream, run = this.run;
      if (stream) {
        if (this.nativeBridge) await this.nativeBridge.configure({ ...options, quality: config.height, fps: config.fps });
        else await stream.getVideoTracks()[0].applyConstraints({ width: { max: config.width }, height: { max: config.height }, frameRate: { max: config.fps } });
        if (this.localStream !== stream || this.run !== run) throw Error('A transmissão foi encerrada durante o ajuste.');
      }
      this.setOptions(options);
      for (const peer of this.peers.values()) {
        if (peer.direction !== 'send') continue;
        peer.budget = perPeerCap(this.config, this.subscribers.length); peer.healthy = 0;
        try { await this.configureSender(peer); }
        catch { this.notice('Qualidade da captura alterada. Um envio ainda está ajustando o encoder.'); }
      }
    };
    const next = (this.qualityChange ?? Promise.resolve()).catch(() => {}).then(apply);
    this.qualityChange = next; return next;
  }
  async startCapture(options) {
    if (this.captureStarting) throw Error('Uma seleção de captura já está em andamento.');
    this.captureStarting = true;
    try { return await this.startCaptureCore(options); }
    finally { this.captureStarting = false; }
  }
  async startCaptureCore(options) {
    if (this.stopPending) await this.stopPending;
    if (!this.identity) throw Error('Entre em uma sala para transmitir.');
    if (this.localStream) throw Error('Pare a fonte atual antes de escolher outra.');
    this.setOptions(options);
    const config = this.config;
    // Called directly from a real click, before any await, preserving transient user activation.
    const identity = this.identity, initialRun = this.run;
    this.nativeBridge = options.nativeSource?.bridge;
    const stream = options.nativeSource ? await options.nativeSource.bridge.start(options.nativeSource.sourceId, options) : await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: config.width }, height: { ideal: config.height }, frameRate: { ideal: config.fps } },
      audio: options.audio === 'window' ? { suppressLocalAudioPlayback: false } : false,
      systemAudio: 'exclude', windowAudio: options.audio === 'window' ? 'window' : 'exclude', selfBrowserSurface: 'exclude'
    });
    if (this.identity !== identity || this.run !== initialRun) { if (this.nativeBridge) { await this.nativeBridge.stop(); this.nativeBridge = null; } for (const track of stream.getTracks()) track.stop(); throw Error("A sala foi encerrada durante a seleção."); }
    this.localId = crypto.randomUUID();
    this.run++; const run = this.run;
    this.localStream = stream;
    this.captureAudioMuted = false;
    try {
      const video = stream.getVideoTracks()[0];
      video.contentHint = 'motion';
      if (!options.nativeSource) await video.applyConstraints({ width: { max: config.width }, height: { max: config.height }, frameRate: { max: config.fps } });
      video.onended = () => { if (this.localStream === stream) void this.stopCapture(); };
      if (options.audio === 'system') {
        await this.startSystemAudio(stream,run);
      }
      if (this.run !== run || this.localStream !== stream) return;
      this.event('capture', { stream, streamId: this.localId, source: this.nativeBridge?.name ?? video.label, settings: video.getSettings(), audio: stream.getAudioTracks().length > 0, audioMode: options.audio });
      await this.native('stream', { active: true, streamId: this.localId });
      this.ensureViewers();
      if (!stream.getAudioTracks().length && options.audio !== 'none') this.notice('Vídeo ativo, sem faixa de áudio. O seletor não forneceu áudio da janela. Pare e escolha WASAPI para compartilhar todo o sistema, se desejar.');
    } catch (error) { await this.stopCapture(); throw error; }
  }
  async startSystemAudio(stream,run) {
    const format=await this.native('audioStart');
    if(this.localStream!==stream || this.run!==run) { await this.native('audioStop');throw Error('A transmissão foi encerrada.'); }
    this.audioContext=new AudioContext({sampleRate:format.sampleRate,latencyHint:'interactive'});
    await this.audioContext.audioWorklet.addModule('pcm-worklet.js');
    if(this.localStream!==stream || this.run!==run)throw Error('A transmissão foi encerrada.');
    this.audioNode=new AudioWorkletNode(this.audioContext,'pcm-source',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]});
    this.audioDestination=this.audioContext.createMediaStreamDestination();this.audioNode.connect(this.audioDestination);await this.audioContext.resume();
    if(this.localStream!==stream || this.run!==run)throw Error('A transmissão foi encerrada.');
    for(const track of this.audioDestination.stream.getAudioTracks())stream.addTrack(track);
  }
  async enableCaptureAudio() {
    if(this.audioChange)return this.audioChange;
    if(!this.localStream)throw Error('Inicie uma transmissão primeiro.');
    if(this.localStream.getAudioTracks().length){this.setCaptureAudioMuted(false);return;}
    const stream=this.localStream,run=this.run;
    this.audioChange=(async()=>{
      if(this.localStream!==stream||this.run!==run)throw Error('A transmissão foi encerrada.');
      try {
        await this.startSystemAudio(stream,run);
        const track=stream.getAudioTracks()[0];
        for(const peer of this.peers.values()) {
          if(peer.direction!=='send'||!this.validPeer(peer))continue;
          if(peer.audioSender)await peer.audioSender.replaceTrack(track);
          else {const sub=this.subscribers.find(s=>s.subscriptionId===peer.key);if(sub)await this.offer(sub,true);}
        }
        if(this.localStream!==stream||this.run!==run)throw Error('A transmissão foi encerrada.');
        this.captureAudioMuted=false;this.event('captureAudio',{muted:false,added:true});
      } catch(error) {
        for(const peer of this.peers.values())if(peer.direction==='send'&&peer.audioSender)try{await peer.audioSender.replaceTrack(null);}catch{}
        for(const track of stream.getAudioTracks()){stream.removeTrack(track);track.stop();}
        this.audioNode?.disconnect();this.audioNode=null;if(this.audioContext)await this.audioContext.close();this.audioContext=null;
        try{await this.native('audioStop');}catch{}throw error;
      }
    })().finally(()=>{this.audioChange=null;});
    return this.audioChange;
  }
  pushPcm(data) {
    if (!this.audioNode) return;
    const raw = atob(data); const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    this.audioNode.port.postMessage(bytes.buffer, [bytes.buffer]);
  }
  setCaptureAudioMuted(muted) {
    const tracks = this.localStream?.getAudioTracks() ?? [];
    if (!tracks.length) throw Error('Esta captura foi iniciada sem áudio. Escolha uma fonte com áudio na próxima transmissão.');
    this.captureAudioMuted = Boolean(muted);
    for (const track of tracks) track.enabled = !this.captureAudioMuted;
    this.event('captureAudio', { muted:this.captureAudioMuted });
  }
  ensureViewers() {
    if (!this.localStream) return;
    for (const sub of this.subscribers.filter(s => s.streamId === this.localId)) {
      if (!this.peers.has(sub.subscriptionId) && !this.creating.has(sub.subscriptionId) && (this.attempts.get(sub.subscriptionId) ?? 0) <= 3)
        void this.offer(sub).catch(error => this.notice(error.message));
      const peer = this.peers.get(sub.subscriptionId);
      if (peer) void this.configureSender(peer).catch(() => {});
    }
  }
  async offer(sub, replacing = false) {
    const key = sub.subscriptionId;
    if (!this.localStream || this.localId !== sub.streamId || this.creating.has(key)) return;
    this.creating.add(key); const run = this.run; const stream = this.localStream;
    let peer;
    try {
      const config = await this.ice();
      if (this.run !== run || this.localStream !== stream || !this.subscribers.some(s => s.subscriptionId === key)) return;
      if (replacing) this.closePeer(key);
      if (this.peers.has(key)) return;
      peer = this.newPeer(sub.viewerId, sub, 'send', crypto.randomUUID(), config);
      for (const track of stream.getTracks()) peer.pc.addTrack(track, stream);
      peer.audioSender=peer.pc.getSenders().find(sender=>sender.track?.kind==='audio');
      // Reserve audio without capturing anything; replaceTrack can enable sound later without new ICE/video.
      if(!peer.audioSender&&peer.pc.addTransceiver)peer.audioSender=peer.pc.addTransceiver('audio',{direction:'sendonly',streams:[stream]}).sender;
      await this.camera.reserve(peer);
      if(!this.validPeer(peer)){this.closePeer(key);return;}
      const transceiver = peer.pc.getTransceivers().find(t => t.sender.track?.kind === 'video');
      const codecs = RTCRtpSender.getCapabilities('video')?.codecs;
      if (transceiver?.setCodecPreferences && codecs) {
        try { transceiver.setCodecPreferences([...codecs.filter(c => c.mimeType.toLowerCase() === 'video/h264'), ...codecs.filter(c => c.mimeType.toLowerCase() !== 'video/h264')]); } catch { }
      }
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      if (!this.validPeer(peer)) return;
      peer.screenMid=transceiver?.mid;
      await this.signal(peer, { kind: 'offer', sdp: tailDescription(peer.pc.localDescription.sdp, peer.tailPreferred || this.zeroTierProof),cameraMid:peer.cameraTransceiver?.mid??null,cameraActive:Boolean(this.cameraStream) });
      peer.sent = true; await this.flushLocal(peer); await this.configureSender(peer);
    } catch (error) {
      if (peer && this.peers.get(key) === peer) this.closePeer(key);
      throw error;
    } finally { this.creating.delete(key); }
  }
  newPeer(id, sub, direction, session, config) {
    const pc = new RTCPeerConnection(config), key = sub.subscriptionId;
    const peer = { key, id, streamId: sub.streamId, publisherId: direction === 'send' ? this.identity.participantId : id, direction, session, pc,
      startedAt: performance.now(), candidates: { host: 0, srflx: 0, prflx: 0 }, stunError: false, sent: false, localIce: [], remoteIce: [], last: null, budget: perPeerCap(this.config, this.subscribers.length), healthy: 0, recovery: null };
    peer.tailPreferred = this.tailscaleEnabled && this.tailscale?.connected;
    peer.tailSnapshot = this.tailscale; peer.tailCandidates = 0; peer.deferredRemoteIce = [];
    this.failedConnections.delete(key);
    this.peers.set(key, peer);
    if (peer.tailPreferred) peer.tailTimer = setTimeout(() => this.releaseFallback(peer), 4000);
    const recover = () => this.recover(key, peer).catch(error => this.notice(error.message));
    peer.connectDeadline = setTimeout(() => { if (this.validPeer(peer) && pc.connectionState !== 'connected') void recover(); }, 30_000);
    pc.onicecandidate = ({ candidate }) => {
      if (!this.validPeer(peer) || !candidate || candidate.type === 'relay') return;
      if (this.zeroTierProof && !zeroTierCandidate(candidate, this.zeroTier)) return;
      if (candidate && candidate.type in peer.candidates) peer.candidates[candidate.type]++;
      // A null event is local gathering completion. Only actual per-generation
      // candidates (including their empty-string marker) go to the remote peer.
      const ice = candidate.toJSON();
      const payload = { kind: 'ice', candidate: ice.candidate ?? '', sdpMid: ice.sdpMid ?? null, sdpMLineIndex: ice.sdpMLineIndex ?? null };
      const tail = localTailCandidate(candidate, peer.tailSnapshot);
      if (tail) peer.tailCandidates++;
      peer.localIce.push(payload);
      if (peer.sent) void this.flushLocal(peer).catch(error => this.notice(error.message));
    };
    pc.onicecandidateerror = () => { if (this.validPeer(peer)) peer.stunError = true; };
    pc.ontrack = e => {
      if(direction!=='receive'||!this.validPeer(peer))return;
      const stream=e.streams[0]??new MediaStream([e.track]);
      if(e.track.kind==='video'&&peer.cameraMid&&e.transceiver?.mid===peer.cameraMid){
        peer.remoteCameraStream=stream;
        const update=()=>{if(this.validPeer(peer))this.event('remoteCamera',{id,streamId:peer.streamId,stream:peer.cameraActive&&!e.track.muted&&e.track.readyState==='live'?stream:null});};
        e.track.onunmute=update;e.track.onmute=update;e.track.onended=update;update();
      }else{if(e.track.kind==='video')peer.screenMid=e.transceiver?.mid;this.event('remote',{id,streamId:peer.streamId,stream});}
    };
    pc.onconnectionstatechange = () => {
      if (!this.validPeer(peer)) return;
      this.event('peerState', { id, direction, state: pc.connectionState });
      if (pc.connectionState === 'connected') { clearTimeout(peer.recovery); clearTimeout(peer.connectDeadline); peer.recovery = null; this.attempts.delete(key); }
      if ((pc.connectionState === 'failed' || pc.connectionState === 'disconnected') && !peer.recovery)
        peer.recovery = setTimeout(recover, pc.connectionState === 'failed' ? 1000 : 6000);
    };
    return peer;
  }
  releaseFallback(peer) {
    if (!this.validPeer(peer)) return;
    peer.fallbackReleased = true;
    if (!peer.tailCandidates) this.notice('O WebView2 ainda não ofereceu um endereço Tailscale. Tentando a conexão normal. Confirme a rede privada e reinicie o StreamRoom após ativar a opção.');
    this.signalQueue = (this.signalQueue ?? Promise.resolve()).then(async () => {
      for (const ice of peer.deferredRemoteIce.splice(0)) {
        if (!this.validPeer(peer)) return;
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(ice); else peer.remoteIce.push(ice);
      }
    }).catch(error => this.notice(error.message));
    return this.signalQueue;
  }
  flushLocal(peer) {
    // One ordered queue for both buffered and newly discovered ICE candidates.
    // End-of-candidates must not pass candidates waiting on a slower signaling send.
    peer.iceSending = (peer.iceSending ?? Promise.resolve()).then(async () => {
      while (this.validPeer(peer) && peer.localIce.length) await this.signal(peer, peer.localIce.shift());
    });
    return peer.iceSending;
  }
  async recover(key, expectedPeer) {
    const peer = this.peers.get(key);
    if (!peer || (expectedPeer && peer !== expectedPeer) || !this.validPeer(peer) || peer.recovering) return;
    peer.recovering = true;
    try {
      clearTimeout(peer.connectDeadline); clearTimeout(peer.recovery); peer.recovery = null;
      const attempts = (this.attempts.get(key) ?? 0) + 1; this.attempts.set(key, attempts);
      if (attempts > 3) {
        const failureMessage = this.zeroTierProof ? 'Não foi possível conectar a mídia pela rede ZeroTier. Confira se os dois PCs estão autorizados na mesma rede, com a opção ativada e o StreamRoom reiniciado. O diagnóstico foi preservado.' : DIRECT_FAILURE;
        // Preserve safe summaries before closePeer discards the failed RTCPeerConnection.
        this.failedConnections.set(key, {
          key, id: peer.id, publisherId: peer.publisherId, direction: peer.direction,
          state: 'failed', failed: true, direct: false, message: failureMessage, tailscaleAttempted: Boolean(peer.tailPreferred), tailscaleCandidates: peer.tailCandidates,
          iceState: peer.pc.iceConnectionState ?? 'unknown', gathering: peer.pc.iceGatheringState ?? 'unknown',
          candidates: { ...peer.candidates }, remoteCandidates: peer.remoteCandidates ?? 0,
          remotePublicCandidates: peer.remotePublicCandidates ?? 0,
          descriptionReceived: Boolean(peer.pc.remoteDescription), stunError: peer.stunError,
          elapsed: Math.floor((performance.now() - peer.startedAt) / 1000), attempts
        });
        this.closePeer(key);
        this.event('stats', [...this.failedConnections.values()]);
        this.event('connectionError', { id: peer.id, message: failureMessage }); return;
      }
      if (peer.direction === 'send') {
        const sub = this.subscribers.find(s => s.subscriptionId === key); if (sub) await this.offer(sub, true);
      } else {
        await this.signal(peer, { kind: 'restart' });
        if (this.validPeer(peer)) peer.connectDeadline = setTimeout(() => this.recover(key, peer).catch(error => this.notice(error.message)), 30_000);
      }
    } finally { peer.recovering = false; }
  }
  signal(peer, payload) {
    return this.native('signal', { to: peer.id, payload: { ...payload, streamId: peer.streamId, subscriptionId: peer.key, session: peer.session } });
  }
  enqueueSignal(from, payload) {
    if (!this.identity) { if (this.pending.length < 128) this.pending.push({ from, payload }); return; }
    const identity = this.identity;
    this.signalQueue = (this.signalQueue ?? Promise.resolve()).then(() => this.identity === identity ? this.receiveSignal(from, payload) : undefined)
      .catch(error => this.notice('Falha na negociação de mídia: ' + error.message));
  }
  async receiveSignal(from, payload) {
    if (!this.identity || !this.participants.some(p => p.id === from)) return;
    const key = payload.subscriptionId;
    const sub = this.subscriptions.find(s => s.publisherId === from && s.streamId === payload.streamId && s.subscriptionId === key);
    let peer = this.peers.get(key);
    if (payload.kind === 'restart') {
      if (peer?.direction === 'send' && peer.id === from && payload.session === peer.session) await this.recover(key, peer);
      return;
    }
    if (payload.kind === 'offer' && sub) {
      if (peer) this.closePeer(key);
      const config = await this.ice();
      if (!this.identity || !this.subscriptions.some(s => s.subscriptionId === key && s.streamId === payload.streamId)) return;
      peer = this.newPeer(from, sub, 'receive', payload.session, config);
      peer.cameraMid=payload.cameraMid??null;peer.cameraActive=payload.cameraActive===true;
      await peer.pc.setRemoteDescription({ type: 'offer', sdp: tailDescription(payload.sdp, this.zeroTierProof) });
      if (!this.validPeer(peer)) return;
      await peer.pc.setLocalDescription(await peer.pc.createAnswer());
      if (!this.validPeer(peer)) return;
      await this.signal(peer, { kind: 'answer', sdp: tailDescription(peer.pc.localDescription.sdp, peer.tailPreferred || this.zeroTierProof) });
      peer.sent = true; await this.flushLocal(peer); return;
    }
    if (!peer || peer.id !== from || payload.streamId !== peer.streamId || payload.session !== peer.session || !this.validPeer(peer)) return;
    if(payload.kind==='camera'&&peer.direction==='receive'){
      peer.cameraActive=payload.active===true;
      this.event('remoteCamera',{id:peer.id,streamId:peer.streamId,stream:peer.cameraActive?peer.remoteCameraStream??null:null});return;
    }
    if (payload.kind === 'answer' && peer.direction === 'send' && peer.pc.signalingState === 'have-local-offer') {
      await peer.pc.setRemoteDescription({ type: 'answer', sdp: tailDescription(payload.sdp, this.zeroTierProof) });
      for (const ice of peer.remoteIce.splice(0)) if (this.validPeer(peer)) await peer.pc.addIceCandidate(ice);
    } else if (payload.kind === 'ice' && !/ typ relay(?: |$)/.test(payload.candidate)) {
      if (payload.candidate) { peer.remoteCandidates = (peer.remoteCandidates ?? 0) + 1; if (/ typ (?:srflx|prflx)(?: |$)/.test(payload.candidate)) peer.remotePublicCandidates = (peer.remotePublicCandidates ?? 0) + 1; }
      const ice = { candidate: payload.candidate, sdpMid: payload.sdpMid, sdpMLineIndex: payload.sdpMLineIndex };
      if (peer.tailPreferred && !peer.fallbackReleased && (deferTailCandidate(ice, peer.tailSnapshot) || !payload.candidate && peer.deferredRemoteIce.length)) {
        if (peer.deferredRemoteIce.length < 128) peer.deferredRemoteIce.push(ice);
        return;
      }
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(ice); else if (peer.remoteIce.length < 128) peer.remoteIce.push(ice);
    }
  }
  async configureSender(peer, suggestion) {
    const sender = peer.pc.getSenders().find(s => s.track?.kind === 'video');
    if (!sender) return;
    const cap = perPeerCap(this.config, this.subscribers.length);
    const parameters = sender.getParameters();
    if (!parameters.encodings?.length) return;
    parameters.degradationPreference = 'maintain-framerate';
    parameters.encodings[0].maxBitrate = Math.round(Math.min(suggestion?.bitrate ?? peer.budget, cap));
    const requested = this.subscribers.find(s => s.subscriptionId === peer.key);
    parameters.encodings[0].maxFramerate = Math.min(suggestion?.fps ?? this.config.fps, this.config.fps, requested?.fps ?? 60);
    parameters.encodings[0].scaleResolutionDownBy = Math.max(suggestion?.scale ?? 1, requested ? this.config.height / requested.height : 1, 1);
    const encoding = parameters.encodings[0];
    if(peer.cameraSender){
      const cameraBudget=peer.cameraSender.track?Math.min(800000,Math.min(peer.budget,cap)*.15):0;
      encoding.maxBitrate=Math.max(64000,encoding.maxBitrate-cameraBudget);
      const cameraParameters=peer.cameraSender.getParameters();
      if(cameraParameters.encodings?.length){cameraParameters.encodings[0].maxBitrate=Math.max(32000,cameraBudget||32000);cameraParameters.encodings[0].maxFramerate=15;
        const signature=[cameraParameters.encodings[0].maxBitrate,15].join(':');if(peer.cameraEncoding!==signature){await peer.cameraSender.setParameters(cameraParameters);peer.cameraEncoding=signature;}}
    }
    const signature = [encoding.maxBitrate, encoding.maxFramerate, encoding.scaleResolutionDownBy, parameters.degradationPreference].join(':');
    if (peer.appliedEncoding === signature) return;
    await sender.setParameters(parameters);
    peer.appliedEncoding = signature;
  }
  async measure() {
    if (this.statsBusy) return;
    this.statsBusy = true;
    const rows = [];
    try {
      for (const peer of this.peers.values()) {
        if (!this.validPeer(peer)) continue;
        const reports = await peer.pc.getStats();
        let video, audio, remote, pair, codec;
        for (const r of reports.values()) {
          if ((r.type === (peer.direction === 'send' ? 'outbound-rtp' : 'inbound-rtp')) && r.kind === 'video'&&(!peer.screenMid||!r.mid||r.mid===peer.screenMid)) video = r;
          if ((r.type === 'outbound-rtp' || r.type === 'inbound-rtp') && r.kind === 'audio') audio = r;
          if (r.type === 'transport' && r.selectedCandidatePairId) pair = reports.get(r.selectedCandidatePairId);
        }
        if(video)remote=video.remoteId?reports.get(video.remoteId):[...reports.values()].find(r=>r.type==='remote-inbound-rtp'&&r.localId===video.id);
        if (video?.codecId) codec = reports.get(video.codecId);
        const tailStatus = this.tailscale?.addresses?.length ? this.tailscale : this.tailscaleKnown
          ? { ...this.tailscaleKnown, connected: false, state: this.tailscale?.state ?? 'Unavailable' } : null;
        const ordinaryRoute = tailscaleRoute(reports, tailStatus) ?? directRoute(reports);
        const route = this.zeroTierProof ? zeroTierRoute(reports, this.zeroTier) ?? { ...ordinaryRoute, confirmed: false, label: 'ZeroTier · aguardando validação da interface de mídia' } : ordinaryRoute;
        if (route.relayed) { this.closePeer(peer.key); this.event('connectionError', { id: peer.id, message: 'Rota relay detectada e bloqueada. ' + DIRECT_FAILURE }); continue; }
        const bytes = video?.bytesSent ?? video?.bytesReceived ?? 0;
        const packets = video?.packetsSent ?? video?.packetsReceived ?? 0;
        const lost = remote?.packetsLost ?? video?.packetsLost ?? 0;
        const now = video?.timestamp ?? performance.now();
        const bitrate = peer.last && now > peer.last.time ? Math.max(0, (bytes - peer.last.bytes) * 8 / (now - peer.last.time) / 1000) : null;
        const loss = peer.last && packets > peer.last.packets ? Math.max(0, lost - peer.last.lost) / Math.max(1, packets - peer.last.packets) : 0;
        const rtt = (remote?.roundTripTime ?? pair?.currentRoundTripTime ?? 0) * 1000;
        peer.last = { time: now, bytes, packets, lost };
        const hardware = video?.encoderImplementation ?? video?.decoderImplementation ?? 'Não informado';
        rows.push({ id: peer.id, key: peer.key, direction: peer.direction, publisherId: peer.publisherId, state: peer.pc.connectionState, bitrate, fps: video?.framesPerSecond ?? null,
          width: video?.frameWidth ?? null, height: video?.frameHeight ?? null, loss, rtt: rtt || null,
          codec: codec?.mimeType?.replace('video/', '') ?? 'Negociando', route: route.label, localCandidate: route.localType, remoteCandidate: route.remoteType, transport: route.protocol, direct: route.confirmed, zeroTier: Boolean(route.zeroTier), overlayRoute: route.overlayRoute ?? null, tailscale: Boolean(route.tailscale), overlayRelay: Boolean(route.overlayRelay), tailscaleCandidates: peer.tailCandidates,
          elapsed: Math.floor((performance.now() - peer.startedAt) / 1000), iceState: peer.pc.iceConnectionState, gathering: peer.pc.iceGatheringState, candidates: { ...peer.candidates }, stunError: peer.stunError, frames: video?.framesDecoded ?? video?.framesEncoded ?? 0,
          hardware, powerEfficient: video?.powerEfficientEncoder ?? null, limitation: video?.qualityLimitationReason ?? null,
          audioPackets: audio?.packetsSent ?? audio?.packetsReceived ?? null, audioCodec: audio?.codecId ? reports.get(audio.codecId)?.mimeType : null });
        if (peer.direction === 'send' && video) {
          const cap = perPeerCap(this.config, this.subscribers.length);
          const next = this.automatic ? adapt(peer.budget, cap, { loss, rtt, limitation: video.qualityLimitationReason }, peer.healthy)
            : { bitrate: cap, scale: 1, fps: this.config.fps, healthyCount: 0 };
          peer.budget = next.bitrate; peer.healthy = next.healthyCount;
          try { await this.configureSender(peer, next); } catch { /* Peer may have closed during stats collection. */ }
        }
      }
      this.event('stats', [...rows, ...this.failedConnections.values()]);
    } finally { this.statsBusy = false; }
  }
  closePeer(key) {
    const peer = this.peers.get(key); if (!peer) return;
    this.peers.delete(key); clearTimeout(peer.recovery); clearTimeout(peer.connectDeadline); clearTimeout(peer.tailTimer);
    peer.pc.ontrack = null; peer.pc.onicecandidateerror = null; peer.pc.onicecandidate = null; peer.pc.onconnectionstatechange = null;
    if (peer.direction === "receive") for (const receiver of peer.pc.getReceivers?.() ?? []) receiver.track?.stop();
    peer.pc.close();
    if (peer.direction === 'receive') this.event('remote', { id: peer.id, streamId: peer.streamId, stream: null });
    if(peer.direction==='receive')this.event('remoteCamera',{id:peer.id,streamId:peer.streamId,stream:null});
  }
  stopCapture() {
    if (!this.stopPending) this.stopPending = this.disposeCapture().finally(() => { this.stopPending = null; });
    return this.stopPending;
  }
  async disposeCapture() {
    this.run++; const stream = this.localStream, streamId = this.localId; this.localStream = null; this.localId = null;
    await this.camera.stop();
    if(this.audioChange)try{await this.audioChange;}catch{}
    if (this.nativeBridge) { const bridge = this.nativeBridge; this.nativeBridge = null; try { await bridge.stop(); } catch { } }
    for (const track of stream?.getTracks() ?? []) { track.onended = null; track.stop(); }
    for (const [key, peer] of this.peers) if (peer.direction === 'send') { this.closePeer(key); this.attempts.delete(key); }
    if (this.audioNode) { this.audioNode.disconnect(); this.audioNode = null; }
    if (this.audioContext) { await this.audioContext.close(); this.audioContext = null; }
    try { await this.native('audioStop'); } catch { }
    if (stream && this.identity) { try { await this.native('stream', { active: false, streamId }); } catch { } }
    this.event('capture', null);
  }
  async leave() {
    await this.stopCapture();
    for (const key of this.peers.keys()) this.closePeer(key);
    this.identity = null; this.participants = []; this.subscriptions = []; this.subscribers = []; this.pending = [];
    this.iceCache = null; this.attempts.clear(); this.failedConnections.clear(); this.event('stats', []);
  }
  async shutdown() { clearInterval(this.timer); await this.leave(); }
}
