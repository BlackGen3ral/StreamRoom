// Only the separate, explicitly enabled proof Worker uses these settings.
// These controls limit an experiment; none is a provider billing/spending cap.
export type TurnExperimentSettings = Partial<Record<'TURN_EXPERIMENT' | 'TURN_TEST_EXPIRES_AT' | 'TURN_TEST_ROOM_ID' | 'TURN_CREATE_KEY' | 'TURN_KEY_ID' | 'TURN_KEY_SECRET', string>>;
export const PROOF_MEDIA_MS = 180_000;
export const PROOF_WINDOW_MS = 900_000;
export const turnExperiment = (env: TurnExperimentSettings) => env.TURN_EXPERIMENT === 'true';
export function proofDeadline(env: TurnExperimentSettings, now = Date.now()): number {
  const end = Date.parse(env.TURN_TEST_EXPIRES_AT ?? '');
  if (!turnExperiment(env) || !Number.isFinite(end) || end <= now || end - now > PROOF_WINDOW_MS
      || !/^[a-f0-9-]{36}$/.test(env.TURN_TEST_ROOM_ID ?? '') || !/^[a-f0-9]{64}$/.test(env.TURN_CREATE_KEY ?? '')
      || !/^[a-f0-9]{32}$/.test(env.TURN_KEY_ID ?? '') || !env.TURN_KEY_SECRET) throw Error('Experimento TURN desativado ou fora da janela autorizada.');
  return end;
}
export const hasRelay = (p: { candidate?: unknown; sdp?: unknown }) => / typ relay(?: |$)/.test(String(p.candidate)) || /a=candidate:[^\r\n]* typ relay(?: |[\r\n]|$)/.test(String(p.sdp));
export function relayOnlySignal(p: { kind?: unknown; candidate?: unknown; sdp?: unknown }): boolean {
  if (p.kind === 'ice') return p.candidate === '' || hasRelay(p);
  return typeof p.sdp === 'string' && !p.sdp.split(/\r?\n/).some(line => line.startsWith('a=candidate:') && !/ typ relay(?: |$)/.test(line));
}
function cloudflareUrls(value: unknown): string[] {
  const list = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  return list.filter((url): url is string => typeof url === 'string' && /^(?:turn:turn\.cloudflare\.com:(?:3478|443)\?transport=udp|turn:turn\.cloudflare\.com:(?:3478|80)\?transport=tcp|turns:turn\.cloudflare\.com:(?:5349|443)\?transport=tcp)$/.test(url));
}
export async function proofCredentials(env: TurnExperimentSettings, expiresAt: number, request: typeof fetch = fetch) {
  proofDeadline(env);
  const ttl = Math.floor((Math.min(expiresAt, Date.parse(env.TURN_TEST_EXPIRES_AT!)) - Date.now()) / 1000);
  if (ttl < 10 || ttl > 180) throw Error('Janela de credenciais TURN encerrada.');
  // Long-term key never leaves the server. Only per-participant, expiring ICE
  // credentials go to the authenticated client, as required by the TURN protocol.
  const response = await request(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000), headers: { Authorization: `Bearer ${env.TURN_KEY_SECRET}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl })
  });
  if (!response.ok) throw Error('O provedor não emitiu credenciais TURN.');
  const reader = response.body?.getReader();
  if (!reader) throw Error('Resposta TURN vazia.');
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; if ((size += value.byteLength) > 16384) throw Error('Resposta TURN inválida.'); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const body = JSON.parse(new TextDecoder().decode(bytes));
  const source = Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers];
  const iceServers = source.flatMap((server: Record<string, unknown> | null) => {
    const urls = cloudflareUrls(server?.urls);
    return urls.length && typeof server?.username === 'string' && server.username.length <= 1024 && typeof server.credential === 'string' && server.credential.length <= 1024
      && server.username && server.credential ? [{ urls, username: server.username, credential: server.credential }] : [];
  });
  if (!iceServers.length) throw Error('O provedor não retornou TURN válido.');
  return { type: 'ice_servers', experiment: 'turn-relay-proof', policy: 'relay-only', turnAvailable: true, expiresAt, iceServers };
}
