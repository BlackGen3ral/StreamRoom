// Native WGC -> shared BGRA memory -> VideoFrame -> canvas MediaStreamTrack.
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
    this.options = options; this.active = true;
    this.first = new Promise((resolve, reject) => { this.resolveFirst = resolve; this.rejectFirst = reject; });
    // Attach a rejection handler before requesting the source to avoid unhandled startup failures.
    this.first.catch(() => {});
    try {
      const result = await this.native('nativeCaptureStart', { sourceId, fps: options.fps });
      this.session = result.session; this.name = result.name;
      if (!this.active) throw Error('Seleção de captura cancelada.');
      const timer = setTimeout(() => this.rejectFirst(Error('A fonte não entregou vídeo. Use outra janela ou o modo compatível.')), 10000);
      try { await this.first; } finally { clearTimeout(timer); }
      this.stream = this.canvas.captureStream(options.fps);
      return this.stream;
    } catch (e) { await this.stop(); throw e; }
  }
  frame(e) {
    const meta = e.additionalData;
    if (meta?.type !== 'wgcFrame') return;
    const buffer = e.getBuffer();
    let frame;
    try {
      // Frames can arrive before the native start reply; the native session is unique per capture.
      if (!this.active || (this.session && meta.session !== this.session)) return;
      this.session ??= meta.session;
      const scale = Math.min(1, this.options.quality / meta.height, (this.options.quality * 16 / 9) / meta.width);
      const width = Math.max(2, Math.floor(meta.width * scale / 2) * 2);
      const height = Math.max(2, Math.floor(meta.height * scale / 2) * 2);
      if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
      frame = new VideoFrame(buffer, { format: 'BGRA', codedWidth: meta.width, codedHeight: meta.height, timestamp: Math.round(performance.now() * 1000) });
      this.context.drawImage(frame, 0, 0, width, height);
      this.resolveFirst();
    } catch (error) { this.rejectFirst(error); this.ended(error.message); }
    finally {
      frame?.close(); window.chrome.webview.releaseBuffer(buffer);
      void this.native('nativeFrameAck', { session: meta.session, frame: meta.frame }).catch(() => {});
    }
  }
  async stop() {
    this.active = false;
    this.rejectFirst?.(Error('Captura encerrada.'));
    window.chrome.webview.removeEventListener('sharedbufferreceived', this.listener);
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    if (this.session) await this.native('nativeCaptureStop', { session: this.session });
    this.session = null;
  }
}
