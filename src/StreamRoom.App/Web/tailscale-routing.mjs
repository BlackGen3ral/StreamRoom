// Native status is an allow-list of actual local/tailnet addresses, not a guess
// based on 100.64/10 (which is also used by ISPs). Keep ICE sockets untouched.
export function candidateAddress(candidate) {
  return String(candidate?.address ?? candidate?.ip ?? candidate?.candidate?.split(/\s+/)[4] ?? '').toLowerCase();
}
export function localTailCandidate(candidate, snapshot) {
  return candidate?.type === 'host' && (snapshot?.addresses ?? []).some(ip => ip.toLowerCase() === candidateAddress(candidate));
}
export function deferTailCandidate(candidate, snapshot) {
  const peer = snapshot?.peers?.find(p => p.addresses.some(ip => ip.toLowerCase() === candidateAddress(candidate)));
  // Give ordinary/direct ICE routes a short head start over a known relay or
  // an unverified overlay route. Tailscale itself keeps trying direct traversal.
  return Boolean(peer && (!peer.online || peer.route !== 'direct'));
}
export function tailDescription(description, prefer) {
  // Trickle ICE goes through the ordered candidate queue. Embedded candidates
  // must not bypass the preference window or end that generation prematurely.
  return prefer ? description.replace(/^a=(?:candidate:[^\r\n]*|end-of-candidates)\r?\n/gm, '') : description;
}
export function tailscaleRoute(reports, snapshot) {
  if (!snapshot?.addresses?.length) return null;
  let pair;
  for (const r of reports.values()) if (r.type === 'transport' && r.selectedCandidatePairId) pair = reports.get(r.selectedCandidatePairId);
  if (pair?.state !== 'succeeded') return null;
  const local = reports.get(pair.localCandidateId), remote = reports.get(pair.remoteCandidateId);
  if (!['host', 'srflx', 'prflx'].includes(local?.candidateType) || !['host', 'srflx', 'prflx'].includes(remote?.candidateType)) return null;
  if (!snapshot.addresses.some(ip => ip.toLowerCase() === candidateAddress(local))) return null;
  const peer = snapshot.peers.find(p => p.addresses.some(ip => ip.toLowerCase() === candidateAddress(remote)));
  if (!peer) return null;
  const route = snapshot.state === 'Unavailable' ? 'unknown' : !snapshot.connected || !peer.online ? 'disconnected' : peer.route;
  return { confirmed: route === 'direct', relayed: false, tailscale: true, overlayRelay: route === 'relay',
    label: route === 'direct' ? 'Tailscale · direta' : route === 'relay' ? 'Tailscale · relay' : route === 'disconnected' ? 'Tailscale · desconectada' : 'Tailscale · verificando rota',
    localType: local.candidateType, remoteType: remote.candidateType, protocol: local.protocol ?? '—' };
}
