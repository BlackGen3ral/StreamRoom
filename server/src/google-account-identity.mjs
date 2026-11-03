export const androidAudience = '586504743743-c9u9o5edn1ihv601v2m22s0s1iv6beh8.apps.googleusercontent.com';
const keysUrl = 'https://www.googleapis.com/oauth2/v3/certs';

function bytes(value) {
  if (!/^[\w-]+$/.test(value)) throw new Error('Token inválido.');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}

function decode(value) {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes(value)));
}

export async function verifyGoogleAccountIdentity(token, { audience, expectedNonce }, getKeys = fetch) {
  if (typeof token !== 'string' || token.length > 10000 || !audience || !expectedNonce) {
    throw new Error('Credencial Google inválida.');
  }
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Token inválido.');
  const [headerPart, claimsPart, signature] = parts;
  const header = decode(headerPart);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Assinatura inválida.');

  const response = await getKeys(keysUrl);
  if (!response.ok) throw new Error('Não foi possível conferir a credencial Google.');
  const { keys } = await response.json();
  const jwk = keys.find(key => key.kid === header.kid && key.kty === 'RSA' && key.alg === 'RS256');
  if (!jwk) throw new Error('Chave Google desconhecida.');
  const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  const key = await crypto.subtle.importKey('jwk', jwk, algorithm, false, ['verify']);
  const signed = new TextEncoder().encode(headerPart + '.' + claimsPart);
  if (!await crypto.subtle.verify(algorithm, key, bytes(signature), signed)) {
    throw new Error('Assinatura inválida.');
  }

  const claims = decode(claimsPart);
  const now = Date.now() / 1000;
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss) ||
      claims.aud !== audience || (claims.azp !== undefined && typeof claims.azp !== 'string') || claims.nonce !== expectedNonce ||
      !Number.isFinite(claims.exp) || claims.exp <= now ||
      typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) {
    throw new Error('Identidade Google inválida ou expirada.');
  }
  return {
    subject: claims.sub,
    name: typeof claims.name === 'string' ? claims.name.slice(0, 32) : '',
    picture: typeof claims.picture === 'string' && claims.picture.startsWith('https://')
      ? claims.picture : null
  };
}


// Only the server derives this key. Neither a display name nor an email address
// can be used to find another person's room.
export async function accountRoomKey(verifiedSubject, secret) {
  if (typeof verifiedSubject !== 'string' || !verifiedSubject || verifiedSubject.length > 255 ||
      typeof secret !== 'string' || secret.length < 32) {
    throw new Error('Identidade de sincronização inválida.');
  }
  const utf8 = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', utf8.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, utf8.encode('streamroom:room-sync:v1:' + verifiedSubject));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
}
