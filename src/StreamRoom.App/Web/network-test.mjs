import { directConfiguration, directRoute } from './direct-ice.mjs';
const pending = new Map(); let sequence = 0; let queue = Promise.resolve();
const endpoints = new Map();
const checks = []; const peers = [];
function native(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = String(++sequence); const timer = setTimeout(() => { pending.delete(id); reject(Error('Native timeout: ' + type)); }, 30000);
    pending.set(id, { resolve, reject, timer }); window.chrome.webview.postMessage({ id, type, payload });
  });
}
window.chrome.webview.addEventListener('message', ({ data }) => {
  if (data.type === 'reply') { const p = pending.get(data.id); if (!p) return; clearTimeout(p.timer); pending.delete(data.id); data.ok ? p.resolve(data.result) : p.reject(Error(data.error)); }
  else if (data.type === 'testSignal') {
    queue = queue.then(async () => {
      const e = endpoints.get(data.side + ':' + data.from); if (!e || data.payload.session !== e.session) return;
      const p = data.payload;
      if (p.kind === 'offer') {
        await e.pc.setRemoteDescription({ type: 'offer', sdp: p.sdp });
        await e.pc.setLocalDescription(await e.pc.createAnswer());
        await e.send({ kind: 'answer', sdp: e.pc.localDescription.sdp, session: e.session });
        e.sent = true; for (const ice of e.local.splice(0)) await e.send(ice);
      } else if (p.kind === 'answer') {
        await e.pc.setRemoteDescription({ type: 'answer', sdp: p.sdp });
        for (const c of e.remote.splice(0)) await e.pc.addIceCandidate(c);
      } else if (p.kind === 'ice') {
        const c = { candidate: p.candidate, sdpMid: p.sdpMid, sdpMLineIndex: p.sdpMLineIndex };
        if (e.pc.remoteDescription) await e.pc.addIceCandidate(c); else e.remote.push(c);
      }
    }).catch(error => checks.push({ test: 'signaling', passed: false, error: error.message }));
  }
});
function endpoint(side, to, session, configuration) {
  const pc = new RTCPeerConnection(configuration); peers.push(pc);
  const e = { pc, session, sent: false, local: [], remote: [], send: payload => native('testSignal', { side, to, payload }) };
  endpoints.set(side + ':' + to, e);
  pc.onicecandidate = ({ candidate }) => {
    const c = candidate?.toJSON() ?? { candidate: '', sdpMid: null, sdpMLineIndex: null };
    const p = { kind: 'ice', candidate: c.candidate ?? '', sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null, session };
    if (e.sent) void e.send(p).catch(error => checks.push({ test: 'ice', passed: false, error: error.message })); else e.local.push(p);
  };
  return e;
}
async function channelPair(host, viewer, iceServers) {
  const session = crypto.randomUUID(); const config = directConfiguration({ iceServers });
  const a = endpoint('host', viewer.id, session, config); const b = endpoint(viewer.side, host.id, session, config);
  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('WebRTC timeout')), 25000);
    b.pc.ondatachannel = ({ channel }) => channel.onmessage = ({ data }) => {
      if (data === 'streamroom-real-network-check') { clearTimeout(timer); resolve(true); }
    };
  });
  const channel = a.pc.createDataChannel('network-check');
  channel.onopen = () => channel.send('streamroom-real-network-check');
  await a.pc.setLocalDescription(await a.pc.createOffer());
  await a.send({ kind: 'offer', sdp: a.pc.localDescription.sdp, session }); a.sent = true;
  for (const p of a.local.splice(0)) await a.send(p);
  await received;
  const route = directRoute(await a.pc.getStats());
  if (!route.confirmed) throw Error('Direct route not confirmed: ' + route.label);
  return { test: 'P2P direct data channel', viewer: viewer.side, passed: true, localCandidate: route.localType, remoteCandidate: route.remoteType, protocol: route.protocol };
}
let runtime;
try {
  await native('ready');
  checks.push({ test: 'secure context and WebRTC', passed: isSecureContext && typeof RTCPeerConnection === 'function' });
  const setup = await native('testCreate'); runtime = setup.runtime;
  checks.push({ test: 'five authenticated C# sessions via Cloudflare', passed: setup.clients.length === 5 });
  const host = setup.clients.find(c => c.side === 'host'); const viewers = setup.clients.filter(c => c.side !== 'host');
  checks.push(...await Promise.all(viewers.map(viewer => channelPair(host, viewer, setup.ice.iceServers).catch(error => ({ test: 'P2P data channel', viewer: viewer.side, passed: false, error: error.message })))));
  for (const pc of peers.splice(0)) pc.close(); endpoints.clear();
  checks.push({ test: 'STUN only, no relay credentials', passed: setup.ice.turnAvailable === false && setup.ice.iceServers.every(s => !s.credential && !s.username && s.urls.every(url => url.startsWith('stun:'))) });
} catch (error) { checks.push({ test: 'network runner', passed: false, error: error.message }); }
finally {
  for (const pc of peers) pc.close();
  const result = { passed: checks.length > 0 && checks.every(c => c.passed), runtime, checks, limitation: 'Real DTLS/SCTP channels through production signaling; does not validate capture, video/audio codecs, sync or different physical computers.' };
  document.getElementById('result').textContent = JSON.stringify(result, null, 2);
  await native('testResult', result);
}
