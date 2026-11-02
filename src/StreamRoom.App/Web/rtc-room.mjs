import { directConfiguration, directRoute, DIRECT_FAILURE } from './direct-ice.mjs';
import { profile, perPeerCap, adapt } from './quality.mjs';

export class RtcRoom extends EventTarget {
  constructor(native) {
    super(); this.native = native; this.peers = new Map(); this.creating = new Set(); this.attempts = new Map();
    this.participants = []; this.pending = []; this.identity = null; this.localStream = null; this.run = 0; this.subscriptions = []; this.subscribers = []; this.localId = null;
    this.config = profile(); this.automatic = true; this.statsBusy = false;
    this.timer = setInterval(() => this.measure().catch(error => this.notice(error.message)), 2000);
  }
  event(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  notice(message) { this.event('notice', message); }
  enter(welcome) {
    this.identity = welcome;
    const pending = this.pending.splice(0);
    for (const signal of pending) this.enqueueSignal(signal.from, signal.payload);
  }
  async ice() {
    if (!this.iceCache || Date.now() - this.iceAt > 300_000) {
      if (!this.iceRequest) this.iceRequest = this.native('ice').then(value => { this.iceCache = value; this.iceAt = Date.now(); this.event('ice', 'direct-only'); }).finally(() => { this.iceRequest = null; });
      await this.iceRequest;
    }
    return directConfiguration(this.iceCache);
  }
  updateRoom(state) {
    this.participants = state.participants ?? [];
    this.subscriptions = state.subscriptions ?? [];
    this.subscribers = state.subscribers ?? [];
    const valid = new Set([...this.subscriptions, ...this.subscribers].map(s => s.subscriptionId));
    for (const [key, peer] of this.peers) if (!valid.has(key) || !this.validPeer(peer)) this.closePeer(key);
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
  async startCapture(options) {
    if (this.captureStarting) throw Error('Uma seleção de captura já está em andamento.');
    this.captureStarting = true;
    try { return await this.startCaptureCore(options); }
    finally { this.captureStarting = false; }
  }
  async startCaptureCore(options) {
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
    try {
      const video = stream.getVideoTracks()[0];
      video.contentHint = 'motion';
      if (!options.nativeSource) await video.applyConstraints({ width: { max: config.width }, height: { max: config.height }, frameRate: { max: config.fps } });
      video.onended = () => { if (this.localStream === stream) void this.stopCapture(); };
      if (options.audio === 'system') {
        const format = await this.native('audioStart');
        this.audioContext = new AudioContext({ sampleRate: format.sampleRate, latencyHint: 'interactive' });
        await this.audioContext.audioWorklet.addModule('pcm-worklet.js');
        this.audioNode = new AudioWorkletNode(this.audioContext, 'pcm-source', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
        this.audioDestination = this.audioContext.createMediaStreamDestination();
        this.audioNode.connect(this.audioDestination); await this.audioContext.resume();
        for (const track of this.audioDestination.stream.getAudioTracks()) stream.addTrack(track);
      }
      if (this.run !== run || this.localStream !== stream) return;
      this.event('capture', { stream, streamId: this.localId, source: this.nativeBridge?.name ?? video.label, settings: video.getSettings(), audio: stream.getAudioTracks().length > 0, audioMode: options.audio });
      await this.native('stream', { active: true, streamId: this.localId });
      this.ensureViewers();
      if (!stream.getAudioTracks().length && options.audio !== 'none') this.notice('Vídeo ativo, sem faixa de áudio. O seletor não forneceu áudio da janela. Pare e escolha WASAPI para compartilhar todo o sistema, se desejar.');
    } catch (error) { await this.stopCapture(); throw error; }
  }
  pushPcm(data) {
    if (!this.audioNode) return;
    const raw = atob(data); const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    this.audioNode.port.postMessage(bytes.buffer, [bytes.buffer]);
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
      const transceiver = peer.pc.getTransceivers().find(t => t.sender.track?.kind === 'video');
      const codecs = RTCRtpSender.getCapabilities('video')?.codecs;
      if (transceiver?.setCodecPreferences && codecs) {
        try { transceiver.setCodecPreferences([...codecs.filter(c => c.mimeType.toLowerCase() === 'video/h264'), ...codecs.filter(c => c.mimeType.toLowerCase() !== 'video/h264')]); } catch { }
      }
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      if (!this.validPeer(peer)) return;
      await this.signal(peer, { kind: 'offer', sdp: peer.pc.localDescription.sdp });
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
    this.peers.set(key, peer);
    const recover = () => this.recover(key).catch(error => this.notice(error.message));
    peer.connectDeadline = setTimeout(() => { if (this.validPeer(peer) && pc.connectionState !== 'connected') void recover(); }, 30_000);
    pc.onicecandidate = ({ candidate }) => {
      if (!this.validPeer(peer) || candidate?.type === 'relay') return;
      if (candidate && candidate.type in peer.candidates) peer.candidates[candidate.type]++;
      const ice = candidate?.toJSON() ?? { candidate: '', sdpMid: null, sdpMLineIndex: null };
      const payload = { kind: 'ice', candidate: ice.candidate ?? '', sdpMid: ice.sdpMid ?? null, sdpMLineIndex: ice.sdpMLineIndex ?? null };
      if (!peer.sent) peer.localIce.push(payload); else void this.signal(peer, payload).catch(error => this.notice(error.message));
    };
    pc.onicecandidateerror = () => { if (this.validPeer(peer)) peer.stunError = true; };
    pc.ontrack = e => {
      if (direction === 'receive' && this.validPeer(peer))
        this.event('remote', { id, streamId: peer.streamId, stream: e.streams[0] ?? new MediaStream([e.track]) });
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
  async flushLocal(peer) { for (const payload of peer.localIce.splice(0)) if (this.validPeer(peer)) await this.signal(peer, payload); }
  async recover(key) {
    const peer = this.peers.get(key);
    if (!peer || !this.validPeer(peer)) return;
    clearTimeout(peer.connectDeadline); clearTimeout(peer.recovery); peer.recovery = null;
    const attempts = (this.attempts.get(key) ?? 0) + 1; this.attempts.set(key, attempts);
    if (attempts > 3) { this.closePeer(key); this.event('connectionError', { id: peer.id, message: DIRECT_FAILURE }); return; }
    if (peer.direction === 'send') {
      const sub = this.subscribers.find(s => s.subscriptionId === key); if (sub) await this.offer(sub, true);
    } else {
      await this.signal(peer, { kind: 'restart' });
      if (this.validPeer(peer)) peer.connectDeadline = setTimeout(() => this.recover(key).catch(error => this.notice(error.message)), 30_000);
    }
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
      if (peer?.direction === 'send' && peer.id === from && payload.session === peer.session) await this.recover(key);
      return;
    }
    if (payload.kind === 'offer' && sub) {
      if (peer) this.closePeer(key);
      const config = await this.ice();
      if (!this.identity || !this.subscriptions.some(s => s.subscriptionId === key && s.streamId === payload.streamId)) return;
      peer = this.newPeer(from, sub, 'receive', payload.session, config);
      await peer.pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
      if (!this.validPeer(peer)) return;
      await peer.pc.setLocalDescription(await peer.pc.createAnswer());
      if (!this.validPeer(peer)) return;
      await this.signal(peer, { kind: 'answer', sdp: peer.pc.localDescription.sdp });
      peer.sent = true; await this.flushLocal(peer); return;
    }
    if (!peer || peer.id !== from || payload.streamId !== peer.streamId || payload.session !== peer.session || !this.validPeer(peer)) return;
    if (payload.kind === 'answer' && peer.direction === 'send' && peer.pc.signalingState === 'have-local-offer') {
      await peer.pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
      for (const ice of peer.remoteIce.splice(0)) if (this.validPeer(peer)) await peer.pc.addIceCandidate(ice);
    } else if (payload.kind === 'ice' && !/ typ relay(?: |$)/.test(payload.candidate)) {
      const ice = { candidate: payload.candidate, sdpMid: payload.sdpMid, sdpMLineIndex: payload.sdpMLineIndex };
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
          if ((r.type === (peer.direction === 'send' ? 'outbound-rtp' : 'inbound-rtp')) && r.kind === 'video') video = r;
          if ((r.type === 'outbound-rtp' || r.type === 'inbound-rtp') && r.kind === 'audio') audio = r;
          if (r.type === 'remote-inbound-rtp' && r.kind === 'video') remote = r;
          if (r.type === 'transport' && r.selectedCandidatePairId) pair = reports.get(r.selectedCandidatePairId);
        }
        if (video?.codecId) codec = reports.get(video.codecId);
        const route = directRoute(reports);
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
          codec: codec?.mimeType?.replace('video/', '') ?? 'Negociando', route: route.label, localCandidate: route.localType, remoteCandidate: route.remoteType, transport: route.protocol, direct: route.confirmed,
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
      this.event('stats', rows);
    } finally { this.statsBusy = false; }
  }
  closePeer(key) {
    const peer = this.peers.get(key); if (!peer) return;
    this.peers.delete(key); clearTimeout(peer.recovery); clearTimeout(peer.connectDeadline);
    peer.pc.ontrack = null; peer.pc.onicecandidateerror = null; peer.pc.onicecandidate = null; peer.pc.onconnectionstatechange = null;
    if (peer.direction === "receive") for (const receiver of peer.pc.getReceivers?.() ?? []) receiver.track?.stop();
    peer.pc.close();
    if (peer.direction === 'receive') this.event('remote', { id: peer.id, streamId: peer.streamId, stream: null });
  }
  stopCapture() {
    if (!this.stopPending) this.stopPending = this.disposeCapture().finally(() => { this.stopPending = null; });
    return this.stopPending;
  }
  async disposeCapture() {
    this.run++; const stream = this.localStream, streamId = this.localId; this.localStream = null; this.localId = null;
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
    this.iceCache = null; this.attempts.clear(); this.event('stats', []);
  }
  async shutdown() { clearInterval(this.timer); await this.leave(); }
}
