export const DIRECT_FAILURE = 'Não foi possível estabelecer P2P direto. CGNAT/NAT restritivo, VPN, firewall ou bloqueio de UDP podem impedir a conexão. Esta versão não usa TURN e não tem retransmissão alternativa.';
// Whitelist schemes and strip credentials even when connected to an old/custom server.
export function directConfiguration(value) {
  const urls = (value?.iceServers ?? []).flatMap(server => typeof server.urls === 'string' ? [server.urls] : server.urls ?? [])
    .filter(url => typeof url === 'string' && /^stun:[^\s]+$/i.test(url));
  if (!urls.length) throw Error('Servidor não forneceu STUN válido. Nenhum serviço de retransmissão será ativado.');
  return { iceServers: [{ urls: [...new Set(urls)] }], iceTransportPolicy: 'all', bundlePolicy: 'max-bundle' };
}
export function directRoute(reports) {
  let pair;
  for (const r of reports.values()) if (r.type === 'transport' && r.selectedCandidatePairId) pair = reports.get(r.selectedCandidatePairId);
  const local = pair && reports.get(pair.localCandidateId);
  const remote = pair && reports.get(pair.remoteCandidateId);
  const relayed = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
  const known = c => ['host', 'srflx', 'prflx'].includes(c?.candidateType);
  const confirmed = !relayed && pair?.state === 'succeeded' && known(local) && known(remote);
  return { confirmed, relayed, label: relayed ? 'Rota relay bloqueada' : confirmed ? 'P2P direto confirmado' : 'P2P ainda não confirmado',
    localType: local?.candidateType ?? '—', remoteType: remote?.candidateType ?? '—', protocol: local?.protocol ?? '—' };
}
