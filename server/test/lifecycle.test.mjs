// Actual bundled Room handlers with a virtual clock and in-memory storage/context.
// This tests long-time state transitions, not a real 24h network soak.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = (await readFile(new URL('../dist/index.js', import.meta.url), 'utf8')).replace('import { DurableObject } from "cloudflare:workers";', 'class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }');
const { Room } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
test('Room handlers preserve a live session beyond 24h, persist renewal across hibernation and expire abandoned rooms', async () => {
  const originalNow = Date.now; let now = 1_800_000_000_000;
  Date.now = () => now;
  const metadata = { roomId: crypto.randomUUID(), inviteHash: 'invite', hostHash: 'host', expiresAt: now + 86_400_000 };
  const data = new Map([['room', metadata]]); let alarm, ready, auto;
  const socket = role => ({ attachment: { id: crypto.randomUUID(), role, name: role, lastSeen: now, window: now, count: 0 }, messages: [],
    serializeAttachment(value) { this.attachment = structuredClone(value); }, deserializeAttachment() { return structuredClone(this.attachment); },
    send(value) { this.messages.push(JSON.parse(value)); }, close() { this.closed = true; } });
  const host = socket('host'), viewer = socket('viewer'); const sockets = [host, viewer];
  const ctx = { storage: { get: async key => data.get(key), put: async (key, value) => data.set(key, structuredClone(value)), getAlarm: async () => alarm, setAlarm: async value => { alarm = value; }, deleteAlarm: async () => { alarm = undefined; }, deleteAll: async () => data.clear() },
    blockConcurrencyWhile(fn) { ready = fn(); }, setWebSocketAutoResponse(value) { auto = value; },
    getWebSockets: () => sockets.filter(ws => !ws.closed), getWebSocketAutoResponseTimestamp: ws => ws.pingAt === undefined ? null : new Date(ws.pingAt) };
  const originalPair = globalThis.WebSocketRequestResponsePair;
  globalThis.WebSocketRequestResponsePair = class { constructor(request, response) { this.request = request; this.response = response; } };
  try {
    let room = new Room(ctx, {}); await ready;
    assert.equal(auto.request, '{"type":"ping"}');
    now += 23 * 3_600_000;
    host.pingAt = viewer.pingAt = now;
    await room.alarm();
    assert.equal(host.closed, undefined);
    assert.equal(alarm, now + 300_000);
    await room.webSocketMessage(host, '{"type":"renew"}');
    const renewed = data.get('room').expiresAt;
    assert.equal(renewed, now + 86_400_000);
    assert.equal(viewer.messages.at(-1).type, 'room_renewed');
    // Reconstruct the object from persisted metadata, as after hibernation.
    room = new Room(ctx, {}); await ready;
    now += 2 * 3_600_000; host.pingAt = viewer.pingAt = now;
    await room.alarm();
    assert.equal(host.closed, undefined);
    assert.equal(data.get('room').expiresAt, renewed);
    // A viewer cannot extend a near-expiry room.
    now = renewed - 1_000; host.pingAt = viewer.pingAt = now;
    await room.webSocketMessage(viewer, '{"type":"renew"}');
    assert.equal(viewer.messages.at(-1).code, 'forbidden');
    assert.equal(data.get('room').expiresAt, renewed);
    now = renewed;
    await room.webSocketMessage(host, '{"type":"renew"}');
    assert.equal(data.has('room'), false);
    assert.equal(host.closed, true); assert.equal(viewer.closed, true); assert.equal(alarm, undefined);
  } finally { Date.now = originalNow; globalThis.WebSocketRequestResponsePair = originalPair; }
});
