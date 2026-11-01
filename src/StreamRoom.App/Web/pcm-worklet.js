// Bounded real WASAPI PCM queue. Underruns produce silence; old samples are dropped instead of growing latency.
class PcmSource extends AudioWorkletProcessor {
  constructor() {
    super(); this.capacity = Math.ceil(sampleRate / 2); this.buffer = new Float32Array(this.capacity * 2);
    this.read = 0; this.write = 0; this.count = 0;
    this.port.onmessage = ({ data }) => {
      const input = new Float32Array(data); const frames = input.length / 2;
      if (frames > this.capacity) return;
      while (this.count + frames > this.capacity) { this.read = (this.read + 1) % this.capacity; this.count--; }
      for (let i = 0; i < frames; i++) {
        this.buffer[this.write * 2] = input[i * 2]; this.buffer[this.write * 2 + 1] = input[i * 2 + 1];
        this.write = (this.write + 1) % this.capacity; this.count++;
      }
      if (this.count > sampleRate * .18) {
        const drop = this.count - Math.floor(sampleRate * .08); this.read = (this.read + drop) % this.capacity; this.count -= drop;
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    for (let i = 0; i < out[0].length; i++) {
      const ready = this.count > 0;
      out[0][i] = ready ? this.buffer[this.read * 2] : 0;
      if (out[1]) out[1][i] = ready ? this.buffer[this.read * 2 + 1] : 0;
      if (ready) { this.read = (this.read + 1) % this.capacity; this.count--; }
    }
    return true;
  }
}
registerProcessor('pcm-source', PcmSource);
