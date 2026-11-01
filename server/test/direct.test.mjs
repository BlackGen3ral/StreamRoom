import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directConfiguration, directRoute } from '../../src/StreamRoom.App/Web/direct-ice.mjs';
import { ROOM_TTL, RENEW_WINDOW, renewalExpiry, stale } from '../src/policy.ts';
test('old/custom server cannot enable relay or leak credentials into peer configuration', () => {
  const config = directConfiguration({ iceServers: [{ urls: ['turn:paid.example:3478', 'turns:paid.example', 'stun:stun.cloudflare.com:3478'], credential: 'secret', username: 'user' }] });
  assert.deepEqual(config.iceServers, [{ urls: ['stun:stun.cloudflare.com:3478'] }]);
  assert.equal(config.iceTransportPolicy, 'all');
  assert.throws(() => directConfiguration({ iceServers: [{ urls: 'turn:paid.example' }] }));
});
function route(local, remote, state = 'succeeded') {
  return directRoute(new Map([['transport', { type: 'transport', selectedCandidatePairId: 'pair' }], ['pair', { state, localCandidateId: 'local', remoteCandidateId: 'remote' }], ['local', { candidateType: local, protocol: 'udp' }], ['remote', { candidateType: remote }]]));
}
test('diagnosis requires both selected candidates and blocks remote relay too', () => {
  assert.equal(route('host', 'srflx').confirmed, true);
  assert.equal(route('prflx', 'host').confirmed, true);
  assert.equal(route('host', 'relay').relayed, true);
  assert.equal(route('relay', 'srflx').confirmed, false);
  assert.equal(route('host', undefined).confirmed, false);
  assert.equal(route('host', 'host', 'in-progress').confirmed, false);
  assert.equal(directRoute(new Map()).confirmed, false);
});
test('24 hour lease renews only near expiry; expired rooms never revive', () => {
  const start = 1_800_000_000_000, expiry = start + ROOM_TTL;
  assert.equal(ROOM_TTL, 86_400_000);
  assert.equal(renewalExpiry(expiry, start + 10 * 3_600_000), expiry);
  assert.equal(renewalExpiry(expiry, expiry - RENEW_WINDOW - 1), expiry);
  const renewed = renewalExpiry(expiry, expiry - RENEW_WINDOW);
  assert.equal(renewed, expiry - RENEW_WINDOW + ROOM_TTL);
  assert.equal(renewalExpiry(renewed, expiry), renewed);
  assert.throws(() => renewalExpiry(expiry, expiry));
  assert.throws(() => renewalExpiry(expiry, expiry + 1));
});
test('hibernated authenticated sockets stay alive through runtime pings, not unauthenticated ones', () => {
  const now = 86_400_000;
  assert.equal(stale(0, now - 20_000, true, now), false);
  assert.equal(stale(0, now - 100_000, true, now), true);
  assert.equal(stale(now - 16_000, now, false, now), true);
});
