// Native WGC -> bounded shared BGRA buffer -> VideoFrame -> generated track.
// Canvas capture remains a fallback for older WebView2 runtimes.
// Keeps the existing RTCPeerConnection/encoder and bounded native frame credits.
export class WgcStream {
  constructor(native, ended) {
    this.native = native; this.ended = ended; this.session = null; this.active = false;
    this.listener = e => this.frame(e);
    window.chrome.webview.addEventListener('sharedbufferreceived', this.listener);
  }
  static supported() { return typeof VideoFrame === 'function' && typeof HTMLCanvasElement.prototype.captureStream === 'function'; }
  async start(sourceId, options) {
    if (!WgcStream.supported()) throw Error('Este WebView2 não suporta a ponte de vídeo nativa. Use o modo compatível.');
    this.canvas = document.createElement('canvas');
    this.canvas.width = options.quality * 16 / 9; this.canvas.height = options.quality;
    this.context = this.canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.options = options; this.active = true; this.transport = 'canvas';
    if (typeof MediaStreamTrackGenerator === 'function') {
      this.outputTrack = new MediaStreamTrackGenerator({ kind: 'video' });
      this.writer = this.outputTrack.writable.getWriter();
      this.stream = new MediaStream([this.outputTrack]);
      this.transport = 'video-frame-track';
    }
    this.first = new Promise((resolve, reject) => { this.resolveFirst = resolve; this.rejectFirst = reject; });
    // Attach a rejection handler before requesting the source to avoid unhandled startup failures.
    this.first.catch(() => {});
    try {
      const result = await this.native('nativeCaptureStart', { sourceId, fps: options.fps, quality: options.quality });
      this.session = result.session; this.name = result.name;
      if (!this.active) throw Error('Seleção de captura cancelada.');
      const timer = setTimeout(() => this.rejectFirst(Error('A fonte não entregou vídeo. Use outra janela ou o modo compatível.')), 10000);
      try { await this.first; } finally { clearTimeout(timer); }
      this.stream ??= this.canvas.captureStream(0);
      this.stream.getVideoTracks()[0]?.requestFrame?.();
      return this.stream;
    } catch (e) { await this.stop(); throw e; }
  }
  async configure(options) {
    const session = this.session;
    if (!this.active || !session) throw Error('A captura foi encerrada.');
    await this.native('nativeCaptureConfigure', { session, quality: options.quality, fps: options.fps });
    if (!this.active || this.session !== session) throw Error('A fonte de captura mudou.');
    this.options = { ...this.options, ...options };
  }
  async frame(e) {
    const meta = e.additionalData;
    if (meta?.type !== 'wgcFrame') return;
    const buffer = e.getBuffer();
    let frame, resized;
    try {
      // Frames can arrive before the native start reply; the native session is unique per capture.
      if (!this.active || (this.session && meta.session !== this.session)) return;
      this.session ??= meta.session;
      const scale = Math.min(1, this.options.quality / meta.height, (this.options.quality * 16 / 9) / meta.width);
      const width = Math.max(2, Math.floor(meta.width * scale / 2) * 2);
      const height = Math.max(2, Math.floor(meta.height * scale / 2) * 2);
      if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
      frame = new VideoFrame(buffer, { format: 'BGRA', codedWidth: meta.width, codedHeight: meta.height, timestamp: Math.round(performance.now() * 1000) });
      if (this.writer) {
        // No animation-frame/canvas capture clock: a hidden sender must keep delivering video.
        if (this.writer.desiredSize <= 0) return;
        if (width !== meta.width || height !== meta.height) {
          this.context.drawImage(frame, 0, 0, width, height);
          resized = new VideoFrame(this.canvas, { timestamp: frame.timestamp });
        }
        await this.writer.write(resized ?? frame);
      } else {
        this.context.drawImage(frame, 0, 0, width, height);
        this.stream?.getVideoTracks()[0]?.requestFrame?.();
      }
      this.resolveFirst();
    } catch (error) { this.rejectFirst(error); this.ended(error.message); }
    finally {
      resized?.close(); frame?.close(); window.chrome.webview.releaseBuffer(buffer);
      window.chrome.webview.postMessage({ type: 'nativeFrameAck', payload: { session: meta.session, frame: meta.frame } });
    }
  }
  async stop() {
    this.active = false;
    this.rejectFirst?.(Error('Captura encerrada.'));
    window.chrome.webview.removeEventListener('sharedbufferreceived', this.listener);
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    if (this.writer) { try { await this.writer.abort(); } catch { } this.writer.releaseLock(); this.writer = null; }
    if (this.session) await this.native('nativeCaptureStop', { session: this.session });
    this.session = null;
  }
}
