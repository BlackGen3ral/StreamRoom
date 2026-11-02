import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profile, perPeerCap, adapt } from '../../src/StreamRoom.App/Web/quality.mjs';
test('novo perfil padrão é 1080p60', () => { assert.equal(profile().height,1080); assert.equal(profile().fps,60); });
test('limita upload agregado para quatro espectadores', () => {
  const config = profile(1080, 60, 24);
  assert.equal(config.height, 1080); assert.equal(config.fps, 60);
  assert.ok(perPeerCap(config, 4) * 4 <= config.upload);
});
test('congestionamento reduz bitrate e depois recupera dentro do teto', () => {
  const cap = 6_000_000;
  const reduced = adapt(cap, cap, { loss: .1, rtt: 450, limitation: 'bandwidth' });
  assert.ok(reduced.bitrate < cap); assert.equal(reduced.healthyCount, 0);
  const recovered = adapt(reduced.bitrate, cap, { loss: 0, rtt: 50, limitation: 'none' }, 8);
  assert.ok(recovered.bitrate > reduced.bitrate && recovered.bitrate <= cap);
  const minimum = adapt(350_000, cap, { loss: .5, rtt: 900 });
  assert.equal(minimum.bitrate, 350_000); assert.equal(minimum.scale, 2); assert.equal(minimum.fps, 30);
});
test('entrada inválida não excede resolução ou taxa máxima suportadas', () => {
  const config = profile(4000, 240, 500);
  assert.equal(config.height, 720); assert.equal(config.fps, 30); assert.equal(config.upload, 80_000_000);
});
