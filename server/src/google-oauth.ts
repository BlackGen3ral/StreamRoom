import { clientConfig, type ClientConfigEnv } from './client-config.ts';

export type GoogleOAuthEnv = ClientConfigEnv & { GOOGLE_CLIENT_SECRET?: string; CREATE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> } };
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
async function boundedJson(stream: ReadableStream<Uint8Array> | null, limit: number) {
  if (!stream) throw new Error('empty');
  const reader = stream.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > limit) { await reader.cancel(); throw new Error('size'); } chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function validExchange(value: unknown, clientId: string): value is { client_id: string; code: string; code_verifier: string; redirect_uri: string; grant_type: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (v.client_id !== clientId || !clientId || v.grant_type !== 'authorization_code' || typeof v.code !== 'string' || v.code.length < 1 || v.code.length > 4096
    || typeof v.code_verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(v.code_verifier) || typeof v.redirect_uri !== 'string') return false;
  // Only the desktop app's IPv4 loopback callback, never a caller-chosen remote endpoint.
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/oauth2\/callback$/.exec(v.redirect_uri);
  return Boolean(match && Number(match[1]) >= 1024 && Number(match[1]) <= 65535);
}
export async function googleExchange(request: Request, env: GoogleOAuthEnv, upstream?: typeof fetch): Promise<Response> {
  if (request.headers.has('Origin') || !request.headers.get('Content-Type')?.startsWith('application/json')) return reply({ error: 'invalid_request' }, 400);
  if (!(await env.CREATE_LIMITER.limit({ key: 'google:' + (request.headers.get('CF-Connecting-IP') ?? 'local') })).success) return reply({ error: 'rate_limited' }, 429);
  const config = clientConfig(env);
  if (!config.googleTokenExchangeReady) return reply({ error: 'oauth_not_configured' }, 503);
  let input: unknown;
  try { input = await boundedJson(request.body, 8192); } catch { return reply({ error: 'invalid_request' }, 400); }
  if (!validExchange(input, config.googleClientId)) return reply({ error: 'invalid_request' }, 400);
  const form = new URLSearchParams({ client_id: config.googleClientId, client_secret: env.GOOGLE_CLIENT_SECRET!, code: input.code, code_verifier: input.code_verifier, redirect_uri: input.redirect_uri, grant_type: 'authorization_code' });
  try {
    const options: RequestInit = { method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'}, body: form.toString(), redirect: 'manual' };
    const response = upstream ? await upstream('https://oauth2.googleapis.com/token', options) : await fetch('https://oauth2.googleapis.com/token', options);
    let result;
    try { result = await boundedJson(response.body, 32768); } catch { return reply({ error: 'google_response_invalid' },502); }
    if (!response.ok) {
      const code = ['invalid_grant', 'invalid_client', 'unauthorized_client', 'access_denied'].includes(result?.error) ? result.error : 'google_exchange_failed';
      return reply({ error: code }, 400);
    }
    if (typeof result?.id_token !== 'string' || result.id_token.length > 10000) return reply({ error: 'invalid_identity' }, 502);
    // No access/refresh token, provider description, secret, code or verifier is returned/logged/stored.
    return reply({ id_token: result.id_token });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const reason = message.includes('Illegal invocation') ? 'binding' : message.includes('signal') ? 'signal' : message.includes('redirect') ? 'redirect' : message.includes('timeout') || message.includes('Timeout') ? 'timeout' : message.includes('not a function') ? 'runtime' : 'network';
    return reply({ error: 'google_unavailable', reason }, 502);
  }
}
