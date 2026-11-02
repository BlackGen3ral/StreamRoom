export function createViewerNotifications(play) {
  let stream = null, viewers = new Set();
  return {
    capture(id) { if (id && stream !== id) play('share'); stream = id; viewers = new Set(); },
    update(subscribers) {
      if (!stream) return;
      const next = new Set(subscribers.filter(s => s.streamId === stream).map(s => s.viewerId));
      if ([...next].some(id => !viewers.has(id))) play('join');
      else if ([...viewers].some(id => !next.has(id))) play('leave');
      viewers = next;
    },
    reset() { stream = null; viewers.clear(); }
  };
}

export function createUiSounds(enabled) {
  let context, last = -Infinity;
  function unlock() {
    if (!enabled()) return;
    try { context ??= new AudioContext(); if (context.state === 'suspended') void context.resume().catch(() => {}); } catch { }
  }
  document.addEventListener('pointerdown', unlock, { passive:true }); document.addEventListener('keydown', unlock, { passive:true });
  const notes = { share:[440,660,880], join:[660,880], leave:[660,440] };
  return {
    play(kind) {
      if (!enabled() || !context || context.state !== 'running' || performance.now()-last<350) return;
      last = performance.now();
      for (const [i, frequency] of (notes[kind] ?? []).entries()) {
        const start = context.currentTime + i * .085, oscillator = context.createOscillator(), gain = context.createGain();
        oscillator.type = 'sine'; oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0,start); gain.gain.linearRampToValueAtTime(.045,start+.012); gain.gain.exponentialRampToValueAtTime(.001,start+.11);
        oscillator.connect(gain); gain.connect(context.destination); oscillator.start(start); oscillator.stop(start+.12);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      }
    },
    refresh() { if (!enabled() && context?.state === 'running') void context.suspend().catch(() => {}); else if (enabled()) unlock(); },
    dispose() { document.removeEventListener('pointerdown',unlock); document.removeEventListener('keydown',unlock); if(context)void context.close().catch(()=>{}); }
  };
}
