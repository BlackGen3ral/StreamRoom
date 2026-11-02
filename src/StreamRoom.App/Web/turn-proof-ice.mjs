// Used only when RtcRoom is explicitly constructed for the separate proof build.
export function relayProofConfiguration(value, now = Date.now()) {
  if (value?.experiment !== 'turn-relay-proof' || value.policy !== 'relay-only' || value.turnAvailable !== true
      || !Number.isFinite(value.expiresAt) || value.expiresAt <= now || value.expiresAt - now > 180_000)
    throw Error('Servidor não autorizou um teste TURN curto e isolado.');
  const iceServers = (value.iceServers ?? []).flatMap(server => {
    const urls = (typeof server.urls === 'string' ? [server.urls] : server.urls ?? []).filter(url => typeof url === 'string'
      && /^(?:turn:turn\.cloudflare\.com:(?:3478|443)\?transport=udp|turn:turn\.cloudflare\.com:(?:3478|80)\?transport=tcp|turns:turn\.cloudflare\.com:(?:5349|443)\?transport=tcp)$/.test(url));
    return urls.length && typeof server.username === 'string' && server.username.length > 0 && server.username.length <= 1024
      && typeof server.credential === 'string' && server.credential.length > 0 && server.credential.length <= 1024
      ? [{ urls, username: server.username, credential: server.credential }] : [];
  });
  if (!iceServers.length) throw Error('Credenciais TURN temporárias indisponíveis.');
  return { iceServers, iceTransportPolicy: 'relay', bundlePolicy: 'max-bundle' };
}
export function relayProofRoute(reports) {
  let pair;
  for (const r of reports.values()) if (r.type === 'transport' && r.selectedCandidatePairId) pair = reports.get(r.selectedCandidatePairId);
  const local = pair && reports.get(pair.localCandidateId), remote = pair && reports.get(pair.remoteCandidateId);
  // A local relay proves this endpoint traversed TURN. ICE may discover the
  // remote endpoint as prflx before its signaled relay candidate arrives.
  // Compare both computers' local relay evidence before approving stage two.
  const confirmed = pair?.state === 'succeeded' && local?.candidateType === 'relay';
  return { confirmed: false, turnConfirmed: confirmed, relayed: local?.candidateType === 'relay' || remote?.candidateType === 'relay',
    invalid: pair?.state === 'succeeded' && local && local.candidateType !== 'relay', label: confirmed ? `TURN confirmado · relay/${remote?.candidateType ?? '—'}` : 'TURN ainda não confirmado',
    localType: local?.candidateType ?? '—', remoteType: remote?.candidateType ?? '—', protocol: local?.relayProtocol ?? local?.protocol ?? '—' };
}
