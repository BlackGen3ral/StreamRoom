import { candidateAddress } from './tailscale-routing.mjs';
export function zeroTierCandidate(candidate, snapshot) {
  return candidate?.type === 'host' && snapshot?.connected === true &&
    snapshot.addresses.some(ip => ip.toLowerCase() === candidateAddress(candidate));
}
export function zeroTierRoute(reports, snapshot) {
  if (!snapshot?.connected) return null;
  let pair;
  for (const item of reports.values()) if (item.type === 'transport' && item.selectedCandidatePairId) pair = reports.get(item.selectedCandidatePairId);
  if (pair?.state !== 'succeeded') return null;
  const local = reports.get(pair.localCandidateId), remote = reports.get(pair.remoteCandidateId);
  if (!zeroTierCandidate({ ...local, type: local?.candidateType }, snapshot) || remote?.candidateType !== 'host') return null;
  return { confirmed: true, relayed: false, zeroTier: true, overlayRoute: 'unverified',
    label: 'ZeroTier · mídia conectada; rota direta/relay não verificada',
    localType: local.candidateType, remoteType: remote.candidateType, protocol: local.protocol ?? '—' };
}
