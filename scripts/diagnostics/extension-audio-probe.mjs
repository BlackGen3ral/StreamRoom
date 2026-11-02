// Disposable local compatibility test. Never imported by the normal app.
export async function createAudioProbe(native) {
  let context, oscillator, listener, analyser, chunks = 0, nonzeroChunks = 0;
  try {
    const format = await native('audioStart');
    context = new AudioContext({ sampleRate: format.sampleRate, latencyHint: 'interactive' });
    await context.audioWorklet.addModule('pcm-worklet.js');
    const node = new AudioWorkletNode(context, 'pcm-source', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    const destination = context.createMediaStreamDestination();
    node.connect(destination);
    listener = ({ data }) => {
      if (data.type !== 'pcm') return;
      const bytes = Uint8Array.from(atob(data.data), c => c.charCodeAt(0));
      const samples = new Float32Array(bytes.buffer);
      chunks++;
      if (samples.some(value => Math.abs(value) > 0.0001)) nonzeroChunks++;
      node.port.postMessage(bytes.buffer, [bytes.buffer]);
    };
    chrome.webview.addEventListener('message', listener);
    // Actual default output -> WASAPI loopback -> existing PCM worklet -> RTC.
    oscillator = context.createOscillator();
    const gain = context.createGain(); gain.gain.value = 0.015;
    oscillator.frequency.value = 991;
    oscillator.connect(gain); gain.connect(context.destination);
    await context.resume(); oscillator.start();
    return {
      stream: destination.stream,
      attachReceiver(stream) {
        const source = context.createMediaStreamSource(stream);
        analyser = context.createAnalyser(); analyser.fftSize = 4096;
        const silentOutput = context.createGain(); silentOutput.gain.value = 0;
        source.connect(analyser); analyser.connect(silentOutput); silentOutput.connect(context.destination);
      },
      summarize(reports) {
        const audio = [...reports.values()].find(r => r.type === 'inbound-rtp' && r.kind === 'audio');
        const codec = audio?.codecId && reports.get(audio.codecId);
        const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        const spectrum = new Float32Array(analyser.frequencyBinCount); analyser.getFloatFrequencyData(spectrum);
        const bin = Math.round(991 * analyser.fftSize / context.sampleRate);
        const toneDb = Math.max(...spectrum.slice(bin - 2, bin + 3));
        return { success: chunks > 10 && nonzeroChunks > 5 && (audio?.packetsReceived ?? 0) > 10 && rms > 0.00001 && toneDb > -80,
          pcmChunks: chunks, nonzeroChunks, packetsReceived: audio?.packetsReceived ?? 0,
          samplesReceived: audio?.totalSamplesReceived ?? null, totalAudioEnergy: audio?.totalAudioEnergy ?? null,
          decodedRms: rms, toneDb: Number.isFinite(toneDb) ? toneDb : null,
          codec: codec?.mimeType ?? null, sampleRate: format.sampleRate,
          crossNetwork: 'NOT_TESTED', humanListening: 'NOT_TESTED' };
      },
      async stop() {
        oscillator.stop(); chrome.webview.removeEventListener('message', listener);
        for (const track of destination.stream.getTracks()) track.stop();
        await context.close(); await native('audioStop');
      }
    };
  } catch (error) {
    if (listener) chrome.webview.removeEventListener('message', listener);
    try { oscillator?.stop(); } catch { }
    await context?.close(); await native('audioStop'); throw error;
  }
}
