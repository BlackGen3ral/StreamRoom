import { directConfiguration, directRoute, DIRECT_FAILURE } from './direct-ice.mjs';
import { profile, perPeerCap, adapt } from './quality.mjs';

export class RtcRoom extends EventTarget {
  constructor(native) {
    super(); this.native = native; this.peers = new Map(); this.creating = new Set(); this.attempts = new Map();
    this.participants = []; this.pending = []; this.identity = null; this.localStream = null; this.run = 0; this.requests = new Map();
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
      this.iceCache = await this.native('ice'); this.iceAt = Date.now();
      this.event('ice', 'direct-only');
    }
    return directConfiguration(this.iceCache);
  }
  updateRoom(participants, streaming) {
    if (participants) this.participants = participants;
    const valid = new Set(this.participants.map(p => p.id));
    for (const id of this.peers.keys()) if (!valid.has(id)) this.closePeer(id);
    if (this.identity?.role === 'host' && this.localStream) this.ensureViewers();
    if (this.identity?.role === 'viewer' && streaming === false) {
      for (const id of this.peers.keys()) this.closePeer(id);
      this.event('remote', null);
    }
  }
  setOptions(options) {
    this.config = profile(options.quality, options.fps, options.upload);
    this.automatic = options.autoQuality;
  }
  async startCapture(options) {
    if (this.identity?.role !== 'host') throw Error('Crie uma sala para transmitir.');
    if (this.localStream) throw Error('Pare a fonte atual antes de escolher outra.');
    this.setOptions(options);
    const config = this.config;
    // Called directly from a real click, before any await, preserving transient user activation.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: config.width }, height: { ideal: config.height }, frameRate: { ideal: config.fps } },
      audio: options.audio === 'window' ? { suppressLocalAudioPlayback: false } : false,
      systemAudio: 'exclude', windowAudio: options.audio === 'window' ? 'window' : 'exclude', selfBrowserSurface: 'exclude'
    });
    this.run++; const run = this.run;
    this.localStream = stream;
    try {
      const video = stream.getVideoTracks()[0];
      video.contentHint = 'motion';
      await video.applyConstraints({ width: { max: config.width }, height: { max: config.height }, frameRate: { max: config.fps } });
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
      this.event('capture', { stream, source: video.label, settings: video.getSettings(), audio: stream.getAudioTracks().length > 0, audioMode: options.audio });
      await this.native('stream', { active: true });
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
    for (const peer of this.participants.filter(p => p.role === 'viewer')) {
      if (!this.peers.has(peer.id) && !this.creating.has(peer.id)) void this.offer(peer.id).catch(error => this.notice(error.message));
    }
  }
  async offer(id, replacing = false) {
    if (!this.localStream || this.creating.has(id) || !this.participants.some(p => p.id === id && p.role === 'viewer')) return;
    this.creating.add(id); const run = this.run; const stream = this.localStream;
    try {
      const config = await this.ice();
      if (this.run !== run || this.localStream !== stream) return;
      if (replacing) this.closePeer(id);
      if (this.peers.has(id)) return;
      const peer = this.newPeer(id, crypto.randomUUID(), config);
      for (const track of stream.getTracks()) peer.pc.addTrack(track, stream);
      const transceiver = peer.pc.getTransceivers().find(t => t.sender.track?.kind === 'video');
      const codecs = RTCRtpSender.getCapabilities('video')?.codecs;
      if (transceiver?.setCodecPreferences && codecs) {
        // Prefer interoperable H.264; Chromium selects hardware only when actually available.
        const ordered = [...codecs.filter(c => c.mimeType.toLowerCase() === 'video/h264'), ...codecs.filter(c => c.mimeType.toLowerCase() !== 'video/h264')];
        try { transceiver.setCodecPreferences(ordered); } catch { /* Keep runtime defaults. */ }
      }
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      await this.signal(id, { kind: 'offer', sdp: peer.pc.localDescription.sdp, session: peer.session });
      peer.sent = true; await this.flushLocal(peer);
      await this.configureSender(peer);
    } finally { this.creating.delete(id); }
  }
  newPeer(id, session, config) {
    const pc = new RTCPeerConnection(config);
    const peer = { id, session, pc, sent: false, localIce: [], remoteIce: [], last: null, budget: perPeerCap(this.config, this.participants.filter(p => p.role === 'viewer').length), healthy: 0, recovery: null };
    this.peers.set(id, peer);
    peer.connectDeadline = setTimeout(() => {
      if (this.peers.get(id) === peer && pc.connectionState !== 'connected') void this.recover(id).catch(error => this.notice(error.message));
    }, 30_000);
    pc.onicecandidate = ({ candidate }) => {
      if (this.peers.get(id) !== peer) return;
      if (candidate?.type === 'relay') return;
      const ice = candidate?.toJSON() ?? { candidate: '', sdpMid: null, sdpMLineIndex: null };
      const payload = { kind: 'ice', candidate: ice.candidate ?? '', sdpMid: ice.sdpMid ?? null, sdpMLineIndex: ice.sdpMLineIndex ?? null, session };
      if (!peer.sent) peer.localIce.push(payload);
      else void this.signal(id, payload).catch(error => this.notice(error.message));
    };
    pc.ontrack = e => { if (this.identity?.role === 'viewer' && this.peers.get(id) === peer) this.event('remote', e.streams[0] ?? new MediaStream([e.track])); };
    pc.onconnectionstatechange = () => {
      if (this.peers.get(id) !== peer) return;
      this.event('peerState', { id, state: pc.connectionState });
      if (pc.connectionState === 'connected') { clearTimeout(peer.recovery); clearTimeout(peer.connectDeadline); peer.recovery = null; this.attempts.delete(id); }
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        if (!peer.recovery) peer.recovery = setTimeout(() => this.recover(id).catch(error => this.notice(error.message)), pc.connectionState === 'failed' ? 1000 : 6000);
      }
    };
    return peer;
  }
  async flushLocal(peer) { for (const payload of peer.localIce.splice(0)) await this.signal(peer.id, payload); }
  async recover(id) {
    const current = this.peers.get(id); if (current) { clearTimeout(current.connectDeadline); clearTimeout(current.recovery); current.recovery = null; }
    const attempts = (this.attempts.get(id) ?? 0) + 1; this.attempts.set(id, attempts);
    if (attempts > 3) { this.closePeer(id); this.event('connectionError', { id, message: DIRECT_FAILURE }); return; }
    if (this.identity?.role === 'host') await this.offer(id, true);
    else await this.signal(id, { kind: 'restart' });
  }
  signal(to, payload) { return this.native('signal', { to, payload }); }
  async requestQuality() {
    const host = this.participants.find(p => p.role === 'host');
    if (this.identity?.role === 'viewer' && host) await this.signal(host.id, { kind: 'quality', height: this.config.height, fps: this.config.fps });
  }
  enqueueSignal(from, payload) {
    if (!this.identity) { this.pending.push({ from, payload }); return; }
    this.signalQueue = (this.signalQueue ?? Promise.resolve()).then(() => this.receiveSignal(from, payload)).catch(error => this.notice('Falha na negociação de mídia: ' + error.message));
  }
  async receiveSignal(from, payload) {
    if (!this.participants.some(p => p.id === from)) return;
    if (payload.kind === 'restart') { if (this.identity.role === 'host' && this.localStream) await this.recover(from); return; }
    if (payload.kind === 'quality') {
      if (this.identity.role === 'host') {
        this.requests.set(from, { height: payload.height, fps: payload.fps });
        if (this.peers.has(from)) await this.configureSender(this.peers.get(from));
      }
      return;
    }
    if (payload.kind === 'ice' && / typ relay(?: |$)/.test(payload.candidate)) return;
    let peer = this.peers.get(from);
    if (payload.kind === 'offer' && this.identity.role === 'viewer') {
      if (peer) this.closePeer(from);
      const config = await this.ice();
      if (!this.identity) return;
      peer = this.newPeer(from, payload.session, config);
      await peer.pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
      await peer.pc.setLocalDescription(await peer.pc.createAnswer());
      await this.signal(from, { kind: 'answer', sdp: peer.pc.localDescription.sdp, session: peer.session });
      peer.sent = true; await this.flushLocal(peer); return;
    }
    if (!peer || payload.session !== peer.session) return;
    if (payload.kind === 'answer' && this.identity.role === 'host' && peer.pc.signalingState === 'have-local-offer') {
      await peer.pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
      for (const ice of peer.remoteIce.splice(0)) await peer.pc.addIceCandidate(ice);
    } else if (payload.kind === 'ice') {
      const ice = { candidate: payload.candidate, sdpMid: payload.sdpMid, sdpMLineIndex: payload.sdpMLineIndex };
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(ice); else peer.remoteIce.push(ice);
    }
  }
  async configureSender(peer, suggestion) {
    const sender = peer.pc.getSenders().find(s => s.track?.kind === 'video');
    if (!sender) return;
    const cap = perPeerCap(this.config, this.participants.filter(p => p.role === 'viewer').length);
    const parameters = sender.getParameters();
    if (!parameters.encodings?.length) return;
    parameters.degradationPreference = 'maintain-framerate';
    parameters.encodings[0].maxBitrate = Math.round(Math.min(suggestion?.bitrate ?? peer.budget, cap));
    const requested = this.requests.get(peer.id);
    parameters.encodings[0].maxFramerate = Math.min(suggestion?.fps ?? this.config.fps, this.config.fps, requested?.fps ?? 60);
    parameters.encodings[0].scaleResolutionDownBy = Math.max(suggestion?.scale ?? 1, requested ? this.config.height / requested.height : 1, 1);
    await sender.setParameters(parameters);
  }
  async measure() {
    if (this.statsBusy) return;
    this.statsBusy = true;
    const rows = [];
    try {
      for (const peer of this.peers.values()) {
        if (peer.pc.connectionState === 'closed') continue;
        const reports = await peer.pc.getStats();
        let video, audio, remote, pair, codec;
        for (const r of reports.values()) {
          if ((r.type === 'outbound-rtp' || r.type === 'inbound-rtp') && r.kind === 'video') video = r;
          if ((r.type === 'outbound-rtp' || r.type === 'inbound-rtp') && r.kind === 'audio') audio = r;
          if (r.type === 'remote-inbound-rtp' && r.kind === 'video') remote = r;
          if (r.type === 'transport' && r.selectedCandidatePairId) pair = reports.get(r.selectedCandidatePairId);
        }
        if (video?.codecId) codec = reports.get(video.codecId);
        const route = directRoute(reports);
        if (route.relayed) { this.closePeer(peer.id); this.event('connectionError', { id: peer.id, message: 'Rota relay detectada e bloqueada. ' + DIRECT_FAILURE }); continue; }
        const bytes = video?.bytesSent ?? video?.bytesReceived ?? 0;
        const packets = video?.packetsSent ?? video?.packetsReceived ?? 0;
        const lost = remote?.packetsLost ?? video?.packetsLost ?? 0;
        const now = video?.timestamp ?? performance.now();
        const bitrate = peer.last && now > peer.last.time ? Math.max(0, (bytes - peer.last.bytes) * 8 / (now - peer.last.time) / 1000) : null;
        const loss = peer.last && packets > peer.last.packets ? Math.max(0, lost - peer.last.lost) / Math.max(1, packets - peer.last.packets) : 0;
        const rtt = (remote?.roundTripTime ?? pair?.currentRoundTripTime ?? 0) * 1000;
        peer.last = { time: now, bytes, packets, lost };
        const hardware = video?.encoderImplementation ?? video?.decoderImplementation ?? 'Não informado';
        rows.push({ id: peer.id, state: peer.pc.connectionState, bitrate, fps: video?.framesPerSecond ?? null,
          width: video?.frameWidth ?? null, height: video?.frameHeight ?? null, loss, rtt: rtt || null,
          codec: codec?.mimeType?.replace('video/', '') ?? 'Negociando', route: route.label, localCandidate: route.localType, remoteCandidate: route.remoteType, transport: route.protocol, direct: route.confirmed,
          hardware, powerEfficient: video?.powerEfficientEncoder ?? null, limitation: video?.qualityLimitationReason ?? null,
          audioPackets: audio?.packetsSent ?? audio?.packetsReceived ?? null, audioCodec: audio?.codecId ? reports.get(audio.codecId)?.mimeType : null });
        if (this.identity?.role === 'host' && video) {
          const cap = perPeerCap(this.config, this.participants.filter(p => p.role === 'viewer').length);
          const next = this.automatic ? adapt(peer.budget, cap, { loss, rtt, limitation: video.qualityLimitationReason }, peer.healthy)
            : { bitrate: cap, scale: 1, fps: this.config.fps, healthyCount: 0 };
          peer.budget = next.bitrate; peer.healthy = next.healthyCount;
          try { await this.configureSender(peer, next); } catch { /* Peer may have closed during stats collection. */ }
        }
      }
      this.event('stats', rows);
    } finally { this.statsBusy = false; }
  }
  closePeer(id) {
    const peer = this.peers.get(id); if (!peer) return;
    this.peers.delete(id); clearTimeout(peer.recovery); clearTimeout(peer.connectDeadline); peer.pc.ontrack = null; peer.pc.onicecandidate = null; peer.pc.onconnectionstatechange = null; peer.pc.close();
  }
  async stopCapture() {
    this.run++; const stream = this.localStream; this.localStream = null;
    for (const track of stream?.getTracks() ?? []) { track.onended = null; track.stop(); }
    for (const id of this.peers.keys()) this.closePeer(id);
    if (this.audioNode) { this.audioNode.disconnect(); this.audioNode = null; }
    if (this.audioContext) { await this.audioContext.close(); this.audioContext = null; }
    try { await this.native('audioStop'); } catch { }
    if (stream && this.identity?.role === 'host') { try { await this.native('stream', { active: false }); } catch { } }
    this.event('capture', null);
  }
  async leave() {
    await this.stopCapture();
    for (const id of this.peers.keys()) this.closePeer(id);
    this.identity = null; this.participants = []; this.pending = []; this.iceCache = null; this.attempts.clear(); this.requests.clear();
    this.event('remote', null); this.event('stats', []);
  }
  async shutdown() { clearInterval(this.timer); await this.leave(); }
}
