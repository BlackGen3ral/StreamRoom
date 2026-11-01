import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const base = process.env.STREAMROOM_TEST_URL ?? 'http://127.0.0.1:8787';
async function createRoom() {
  const response = await fetch(base + '/v1/rooms', { method: 'POST' });
  assert.equal(response.status, 201);
  return response.json();
}
function socket(roomId) {
  const ws = new WebSocket(base.replace(/^http/, 'ws') + `/v1/rooms/${roomId}/socket`);
  const messages = [];
  ws.addEventListener('message', e => messages.push(JSON.parse(e.data)));
  const opened = new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  return {
    ws, opened, messages,
    async wait(type, predicate = () => true) {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const found = messages.findIndex(m => m.type === type && predicate(m));
        if (found !== -1) return messages.splice(found, 1)[0];
        await delay(10);
      }
      throw Error('Timed out waiting for ' + type);
    },
    send(value) { ws.send(JSON.stringify(value)); },
    async join(token, displayName = 'Jogador') {
      await opened; this.send({ type: 'join', token, displayName });
      return this.wait('welcome');
    }
  };
}
test('salas reais no runtime Cloudflare', async t => {
  const sockets = [];
  const connect = id => { const client = socket(id); sockets.push(client); return client; };
  t.after(() => { for (const s of sockets) s.ws.close(); });
  const room = await createRoom();
  const host = connect(room.roomId);
  const hostWelcome = await host.join(room.hostToken, 'Criador');
  assert.equal(hostWelcome.role, 'host');
  await t.test('sala de 24h, renovação autorizada e idempotente fora da janela', async () => {
    assert.ok(room.expiresAt - Date.now() > 86_300_000);
    assert.ok(room.expiresAt - Date.now() <= 86_400_000);
    host.send({ type: 'renew' });
    assert.equal((await host.wait('room_renewed')).expiresAt, room.expiresAt);
  });
  await t.test('health e rotas inválidas', async () => {
    assert.equal((await fetch(base + '/health')).status, 200);
    assert.equal((await fetch(base + '/v1/rooms')).status, 404);
    assert.equal((await fetch(base + `/v1/rooms/${room.roomId}/socket`)).status, 426);
  });
  await t.test('convite inválido recusado', async () => {
    const bad = connect(room.roomId); await bad.opened;
    bad.send({ type: 'join', token: '0'.repeat(64), displayName: 'Intruso' });
    assert.equal((await bad.wait('error')).code, 'unauthorized');
  });
  await t.test('nome inválido recusado', async () => {
    const bad = connect(room.roomId); await bad.opened;
    bad.send({ type: 'join', token: room.inviteToken, displayName: 'a'.repeat(33) });
    assert.equal((await bad.wait('error')).code, 'invalid_join');
  });
  await t.test('segundo criador recusado', async () => {
    const bad = connect(room.roomId); await bad.opened;
    bad.send({ type: 'join', token: room.hostToken, displayName: 'Duplicado' });
    assert.equal((await bad.wait('error')).code, 'room_full');
  });
  const guests = [0,1,2,3].map(() => connect(room.roomId));
  const welcomes = await Promise.all(guests.map((g,i) => g.join(room.inviteToken, `Amigo ${i}`)));
  await t.test('quatro convidados simultâneos e lista de cinco', async () => {
    assert.ok(welcomes.every(w => w.role === 'viewer'));
    const state = await host.wait('room', m => m.participants.length === 5);
    assert.equal(state.participants.filter(x => x.role === 'host').length, 1);
    assert.ok(state.participants.every(x => !('token' in x) && !('hostToken' in x)));
  });
  await t.test('sexto participante recusado', async () => {
    const extra = connect(room.roomId); await extra.opened;
    extra.send({ type: 'join', token: room.inviteToken, displayName: 'Extra' });
    assert.equal((await extra.wait('error')).code, 'room_full');
  });
  await t.test('offer dirigida e identidade definida pelo servidor', async () => {
    host.send({ type: 'signal', to: welcomes[0].participantId, from: 'forged', payload: { kind: 'offer', sdp: 'sdp-test' } });
    const signal = await guests[0].wait('signal');
    assert.equal(signal.from, hostWelcome.participantId);
    assert.deepEqual(signal.payload, { kind: 'offer', sdp: 'sdp-test' });
    assert.ok(!guests[1].messages.some(m => m.type === 'signal'));
  });
  await t.test('answer e ICE retornam ao criador', async () => {
    guests[0].send({ type: 'signal', to: hostWelcome.participantId, payload: { kind: 'answer', sdp: 'answer-test' } });
    assert.equal((await host.wait('signal')).payload.kind, 'answer');
    guests[0].send({ type: 'signal', to: hostWelcome.participantId, payload: { kind: 'ice', candidate: 'candidate-test', sdpMid: '0', sdpMLineIndex: 0 } });
    assert.equal((await host.wait('signal')).payload.kind, 'ice');
  });
  await t.test('estado de transmissão é controlado apenas pelo criador', async () => {
    guests[0].send({ type: 'stream', active: true });
    assert.equal((await guests[0].wait('error')).code, 'forbidden');
    host.send({ type: 'stream', active: true });
    assert.equal((await guests[0].wait('room', m => m.streaming === true)).streaming, true);
    host.send({ type: 'stream', active: false });
    assert.equal((await guests[0].wait('room', m => m.streaming === false)).streaming, false);
  });
  await t.test('ICE fornece somente STUN, sem credenciais ou relay', async () => {
    guests[0].send({ type: 'ice_config' });
    const config = await guests[0].wait('ice_servers');
    assert.ok(config.iceServers.some(s => s.urls.some(url => url.startsWith('stun:'))));
    assert.equal(config.turnAvailable, false);
    assert.equal(config.policy, 'direct-only');
    assert.ok(config.iceServers.every(s => !s.username && !s.credential && s.urls.every(url => url.startsWith('stun:'))));
  });
  await t.test('sessão de mídia e pedido de recuperação são preservados', async () => {
    const session = crypto.randomUUID();
    host.send({ type: 'signal', to: welcomes[0].participantId, payload: { kind: 'offer', sdp: 'generation-test', session } });
    assert.equal((await guests[0].wait('signal')).payload.session, session);
    guests[0].send({ type: 'signal', to: hostWelcome.participantId, payload: { kind: 'restart' } });
    assert.equal((await host.wait('signal')).payload.kind, 'restart');
    guests[0].send({ type: 'signal', to: hostWelcome.participantId, payload: { kind: 'quality', height: 720, fps: 30 } });
    assert.deepEqual((await host.wait('signal')).payload, { kind: 'quality', height: 720, fps: 30 });
  });
  await t.test('convidado não pode renovar e candidatos relay são recusados', async () => {
    guests[0].send({ type: 'renew' });
    assert.equal((await guests[0].wait('error')).code, 'forbidden');
    host.send({ type: 'signal', to: welcomes[0].participantId, payload: { kind: 'ice', candidate: 'candidate:1 1 UDP 1 192.0.2.1 10000 typ relay', sdpMid: '0', sdpMLineIndex: 0 } });
    assert.equal((await host.wait('error')).code, 'relay_disabled');
    host.send({ type: 'signal', to: welcomes[0].participantId, payload: { kind: 'offer', sdp: 'v=0\r\na=candidate:1 1 UDP 1 192.0.2.1 10000 typ relay\r\n' } });
    assert.equal((await host.wait('error')).code, 'relay_disabled');
  });
  await t.test('convidados não sinalizam entre si', async () => {
    guests[0].send({ type: 'signal', to: welcomes[1].participantId, payload: { kind: 'offer', sdp: 'bad' } });
    assert.equal((await guests[0].wait('error')).code, 'invalid_target');
  });
  await t.test('oferta de convidado e payload malformado recusados', async () => {
    guests[0].send({ type: 'signal', to: hostWelcome.participantId, payload: { kind: 'offer', sdp: 'bad' } });
    assert.equal((await guests[0].wait('error')).code, 'invalid_signal');
    host.send({ type: 'signal', to: welcomes[0].participantId, payload: { kind: 'ice', candidate: 123 } });
    assert.equal((await host.wait('error')).code, 'invalid_signal');
  });
  await t.test('JSON inválido não derruba sala e ping funciona', async () => {
    guests[0].ws.send('{');
    assert.equal((await guests[0].wait('error')).code, 'invalid_json');
    guests[0].send({ type: 'ping' });
    assert.equal((await guests[0].wait('pong')).type, 'pong');
  });
  await t.test('saída libera vaga', async () => {
    guests[3].send({ type: 'leave' });
    await host.wait('room', m => m.participants.length === 4);
    const replacement = connect(room.roomId);
    assert.equal((await replacement.join(room.inviteToken, 'Substituto')).role, 'viewer');
  });
  await t.test('criador encerra sala e invalida convite', async () => {
    host.send({ type: 'leave' });
    assert.equal((await guests[0].wait('room_closed')).type, 'room_closed');
    // GET requires upgrade; 426 precedes existence lookup. Actual upgrade to closed room fails.
    const invalid = connect(room.roomId);
    await assert.rejects(invalid.opened);
  });
});
