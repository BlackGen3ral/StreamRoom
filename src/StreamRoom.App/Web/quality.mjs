export function profile(resolution = 1080, fps = 60, upload = 24) {
  const height = [480, 720, 1080].includes(Number(resolution)) ? Number(resolution) : 720;
  const frameRate = Number(fps) === 60 ? 60 : 30;
  return { width: Math.round(height * 16 / 9), height, fps: frameRate,
    bitrate: (height === 1080 ? (frameRate === 60 ? 10 : 7) : height === 720 ? (frameRate === 60 ? 6 : 4) : 2) * 1e6,
    upload: Math.max(2, Math.min(80, Number(upload) || 24)) * 1e6 };
}
export function perPeerCap(config, viewers) { return Math.max(350_000, Math.min(config.bitrate, config.upload / Math.max(1, viewers))); }
export function adapt(current, cap, sample, healthyCount = 0) {
  const degraded = sample.loss > .05 || sample.rtt > 350 || sample.limitation === 'bandwidth';
  const budget = degraded ? Math.max(350_000, current * .78) : healthyCount >= 8 ? Math.min(cap, current * 1.1) : Math.min(current, cap);
  return { bitrate: Math.round(Math.min(budget, cap)), healthyCount: degraded ? 0 : healthyCount + 1,
    scale: budget < 1_500_000 ? 2 : budget < 3_000_000 ? 1.5 : 1, fps: budget < 2_000_000 ? 30 : 60 };
}
