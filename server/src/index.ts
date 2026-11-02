import { DurableObject } from 'cloudflare:workers';
import legacy from './legacy';
export { Room } from './legacy';

import { ROOM_TTL, SWEEP_INTERVAL, renewalExpiry, stale } from './policy';
const MAX_MESSAGE = 64 * 1024;
const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
});
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
async function hash(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
type Metadata = { roomId: string; inviteHash: string; hostHash: string; expiresAt: number; persistent?: boolean };
type Watch = { publisherId: string; streamId: string; subscriptionId: string; height: number; fps: number };
type Session = { id: string; name?: string; role?: 'host' | 'viewer'; lastSeen: number; window: number; count: number; streamId?: string; watching?: Watch[] };
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/v1/rooms')) return legacy.fetch(request, env);
    if (url.pathname === '/health' && request.method === 'GET')
      return json({ service: 'StreamRoom signaling', protocol: 2, version: '0.4.1', persistentRooms: true, mediaPolicy: 'direct-only' });
    if (url.pathname === '/v2/rooms' && request.method === 'POST') {
      if (request.body) await request.body.cancel();
      const key = request.headers.get('CF-Connecting-IP') ?? 'local';
      if (!(await env.CREATE_LIMITER.limit({ key })).success)
        return json({ error: 'Muitas salas criadas. Aguarde um minuto.' }, 429);
      const roomId = crypto.randomUUID();
      const inviteToken = token();
      const hostToken = token();
      const persistent = request.headers.get('X-StreamRoom-Persistent') === '1';
      const expiresAt = persistent ? Date.UTC(9999, 11, 31) : Date.now() + ROOM_TTL;
      await env.MULTI_ROOMS.getByName(roomId).initialize({ roomId, inviteHash: await hash(inviteToken), hostHash: await hash(hostToken), expiresAt, persistent });
      return json({ roomId, inviteToken, hostToken, expiresAt, persistent, protocol: 2 }, 201);
    }
    const match = /^\/v2\/rooms\/([a-f0-9-]{36})\/socket$/.exec(url.pathname);
    if (match && request.method === 'GET') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
        return json({ error: 'WebSocket obrigatório.' }, 426);
      // Tokens are sent in the first WebSocket frame, never in the URL or logs.
      return env.MULTI_ROOMS.getByName(match[1]).fetch(request);
    }
    return json({ error: 'Rota inexistente.' }, 404);
  }
} satisfies ExportedHandler<Env>;

export class MultiRoom extends DurableObject<Env> {
  private metadata: Metadata | undefined;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Exact JSON matches are answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
    ctx.blockConcurrencyWhile(async () => { this.metadata = await ctx.storage.get<Metadata>('room'); });
  }
  async initialize(metadata: Metadata) {
    if (this.metadata) throw new Error('Room already exists');
    await this.ctx.storage.put('room', metadata);
    this.metadata = metadata;
    if (!metadata.persistent) await this.ctx.storage.setAlarm(metadata.expiresAt);
  }
  async fetch(_request: Request): Promise<Response> {
    if (!this.metadata || Date.now() >= this.metadata.expiresAt)
      return json({ error: 'Sala inexistente ou expirada.' }, 404);
    if (this.ctx.getWebSockets().length >= 10) return json({ error: 'Sala ocupada.' }, 429);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const now = Date.now();
    server.serializeAttachment({ id: crypto.randomUUID(), lastSeen: now, window: now, count: 0 } satisfies Session);
    const alarm = await this.ctx.storage.getAlarm();
    await this.ctx.storage.setAlarm(Math.min(alarm ?? Infinity, now + 15_000, this.metadata.expiresAt));
    return new Response(null, { status: 101, webSocket: client });
  }
  private sessions(): { ws: WebSocket; session: Session }[] {
    return this.ctx.getWebSockets().map(ws => ({ ws, session: ws.deserializeAttachment() as Session }))
      .filter(x => x.session.role !== undefined);
  }
  private send(ws: WebSocket, value: unknown) {
    try { ws.send(JSON.stringify(value)); } catch { ws.close(1011, 'Conexão indisponível'); }
  }
  private reject(ws: WebSocket, code: string, message: string, close = false) {
    this.send(ws, { type: 'error', code, message });
    if (close) ws.close(1008, code);
  }
  private broadcast() {
    const sessions = this.sessions();
    const participants = sessions.map(({ session: s }) => ({ id: s.id, name: s.name!, role: s.role!, streamId: s.streamId ?? null, streaming: Boolean(s.streamId) }));
    // Watch lists are private to the receiving publisher/subscriber, not room-wide.
    for (const { ws, session: s } of sessions) this.send(ws, {
      type: 'room', participants, subscriptions: s.watching ?? [],
      subscribers: sessions.flatMap(({ session: viewer }) => (viewer.watching ?? [])
        .filter(w => w.publisherId === s.id && w.streamId === s.streamId)
        .map(w => ({ ...w, viewerId: viewer.id })))
    });
  }
  private clearSubscriptions(publisherId: string) {
    for (const { ws, session } of this.sessions()) {
      session.watching = (session.watching ?? []).filter(w => w.publisherId !== publisherId);
      ws.serializeAttachment(session);
    }
  }
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_MESSAGE) {
      this.reject(ws, 'invalid_message', 'Mensagem inválida ou muito grande.', true); return;
    }
    if (!this.metadata || Date.now() >= this.metadata.expiresAt) { await this.end('Sala expirada.'); return; }
    const s = ws.deserializeAttachment() as Session;
    const now = Date.now();
    if (now - s.window >= 10_000) { s.window = now; s.count = 0; }
    if (++s.count > 120) { this.reject(ws, 'rate_limited', 'Muitas mensagens.', true); this.broadcast(); return; }
    s.lastSeen = now;
    ws.serializeAttachment(s);
    let message: unknown;
    try { message = JSON.parse(raw); } catch { this.reject(ws, 'invalid_json', 'JSON inválido.'); return; }
    if (!record(message)) { this.reject(ws, 'invalid_message', 'Objeto obrigatório.'); return; }
    if (!s.role) {
      if (message.protocol !== 2) { this.reject(ws, 'protocol_mismatch', 'Esta sala exige StreamRoom 0.4 ou mais recente. Atualize todos os participantes.', true); return; }
      if (message.type !== 'join' || typeof message.token !== 'string' || !/^[a-f0-9]{64}$/.test(message.token)
        || typeof message.displayName !== 'string' || !message.displayName.trim() || message.displayName.trim().length > 32
        || /[\u0000-\u001f\u007f]/.test(message.displayName)) {
        this.reject(ws, 'invalid_join', 'Informe convite e nome válido (1–32 caracteres).', true); return;
      }
      const digest = await hash(message.token);
      // Re-read after asynchronous hashing; another join may have completed meanwhile.
      if (!this.metadata || Date.now() >= this.metadata.expiresAt) { ws.close(1008, 'room_closed'); return; }
      const role = digest === this.metadata.hostHash ? 'host' : digest === this.metadata.inviteHash ? 'viewer' : undefined;
      if (!role) { this.reject(ws, 'unauthorized', 'Convite inválido.', true); return; }
      const peers = this.sessions();
      if (role === 'host' ? peers.some(x => x.session.role === 'host') : peers.filter(x => x.session.role === 'viewer').length >= 4) {
        this.reject(ws, 'room_full', 'Sala cheia ou criador já conectado.', true); return;
      }
      s.role = role; s.name = message.displayName.trim();
      ws.serializeAttachment(s);
      this.send(ws, { type: 'welcome', participantId: s.id, role, roomId: this.metadata.roomId, expiresAt: this.metadata.expiresAt, persistent: Boolean(this.metadata.persistent), protocol: 2 });
      this.broadcast(); return;
    }
    if (message.type === 'ping') { this.send(ws, { type: 'pong' }); return; }
    if (message.type === 'stream') {
      if (typeof message.active !== 'boolean' || !uuid(message.streamId)) {
        this.reject(ws, 'invalid_stream', 'Informe o identificador da sua transmissão.'); return;
      }
      if (!message.active && s.streamId !== message.streamId) return; // Ignore delayed stop from an old capture.
      if (message.active && s.streamId === message.streamId) return;
      if (message.active && this.sessions().some(p => p.session.id !== s.id && p.session.streamId === message.streamId)) { this.reject(ws, 'duplicate_stream', 'Identificador de transmissão já está em uso.'); return; }
      this.clearSubscriptions(s.id);
      // clearSubscriptions may update this socket's watching list.
      const current = ws.deserializeAttachment() as Session;
      current.streamId = message.active ? message.streamId : undefined;
      ws.serializeAttachment(current); this.broadcast(); return;
    }
    if (message.type === 'watch') {
      if (!uuid(message.publisherId) || !uuid(message.streamId) || !uuid(message.subscriptionId)
        || typeof message.active !== 'boolean' || message.publisherId === s.id) {
        this.reject(ws, 'invalid_watch', 'Seleção de transmissão inválida.'); return;
      }
      s.watching ??= [];
      if (!message.active) {
        s.watching = s.watching.filter(w => w.subscriptionId !== message.subscriptionId);
      } else {
        const publisher = this.sessions().find(p => p.session.id === message.publisherId);
        if (!publisher || publisher.session.streamId !== message.streamId) {
          this.reject(ws, 'stream_unavailable', 'A transmissão já foi encerrada.'); return;
        }
        if (![480, 720, 1080].includes(Number(message.height)) || ![30, 60].includes(Number(message.fps))) {
          this.reject(ws, 'invalid_quality', 'Qualidade inválida.'); return;
        }
        if (this.sessions().some(p => (p.session.watching ?? []).some(w => w.subscriptionId === message.subscriptionId && (p.session.id !== s.id || w.publisherId !== message.publisherId)))) { this.reject(ws, 'duplicate_subscription', 'Identificador de assinatura já está em uso.'); return; }
        // At most one subscription per publisher, up to the other four people.
        s.watching = s.watching.filter(w => w.publisherId !== message.publisherId);
        s.watching.push({ publisherId: message.publisherId, streamId: message.streamId, subscriptionId: message.subscriptionId, height: Number(message.height), fps: Number(message.fps) });
      }
      ws.serializeAttachment(s); this.broadcast(); return;
    }
    if (message.type === 'ice_config') {
      this.send(ws, { type: 'ice_servers', iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }], turnAvailable: false, policy: 'direct-only' }); return;
    }
    if (message.type === 'renew') {
      if (s.role !== 'host') { this.reject(ws, 'forbidden', 'Somente o criador pode renovar a sala.'); return; }
      const expiresAt = this.metadata.persistent ? this.metadata.expiresAt : renewalExpiry(this.metadata.expiresAt, now);
      if (expiresAt !== this.metadata.expiresAt) {
        const updated = { ...this.metadata, expiresAt };
        await this.ctx.storage.put('room', updated);
        // A close event can run across storage awaits; never revive a closed room.
        if (!this.metadata) { await this.ctx.storage.deleteAll(); return; }
        this.metadata = updated;
      }
      for (const { ws: client } of this.sessions()) this.send(client, { type: 'room_renewed', expiresAt });
      return;
    }
    if (message.type === 'destroy') {
      if (s.role !== 'host') { this.reject(ws, 'forbidden', 'Somente o criador pode excluir a sala.'); return; }
      await this.end('O criador excluiu a sala do grupo.'); return;
    }
    if (message.type === 'leave') { await this.depart(ws); ws.close(1000, 'left'); return; }
    if (message.type !== 'signal' || typeof message.to !== 'string' || !record(message.payload)) {
      this.reject(ws, 'invalid_message', 'Tipo de mensagem desconhecido.'); return;
    }
    const target = this.sessions().find(x => x.session.id === message.to);
    if (!target || target.session.id === s.id) { this.reject(ws, 'invalid_target', 'Destino inválido.'); return; }
    const p = message.payload;
    if (!uuid(p.streamId) || !uuid(p.subscriptionId) || !uuid(p.session)) {
      this.reject(ws, 'invalid_signal', 'Identificadores de mídia inválidos.'); return;
    }
    // Direction is defined by the authenticated subscription, never by the room owner's role.
    const sending = s.streamId === p.streamId
      && (target.session.watching ?? []).some(w => w.publisherId === s.id && w.streamId === p.streamId && w.subscriptionId === p.subscriptionId);
    const receiving = target.session.streamId === p.streamId
      && (s.watching ?? []).some(w => w.publisherId === target.session.id && w.streamId === p.streamId && w.subscriptionId === p.subscriptionId);
    if (!sending && !receiving) { this.reject(ws, 'not_subscribed', 'Não existe uma assinatura ativa para essa transmissão.'); return; }
    if (p.kind === 'restart' && receiving) {
      this.send(target.ws, { type: 'signal', from: s.id, payload: { kind: 'restart', streamId: p.streamId, subscriptionId: p.subscriptionId, session: p.session } }); return;
    }
    const valid = (p.kind === 'offer' && sending || p.kind === 'answer' && receiving)
      ? typeof p.sdp === 'string' && p.sdp.length > 0 && p.sdp.length <= 48_000
      : p.kind === 'ice' && typeof p.candidate === 'string' && p.candidate.length <= 4096
        && (p.sdpMid === null || typeof p.sdpMid === 'string' && p.sdpMid.length <= 256)
        && (p.sdpMLineIndex === null || Number.isInteger(p.sdpMLineIndex) && Number(p.sdpMLineIndex) >= 0 && Number(p.sdpMLineIndex) <= 255);
    if (!valid) { this.reject(ws, 'invalid_signal', 'Sinalização inválida.'); return; }
    if (p.kind === 'ice' && / typ relay(?: |$)/.test(String(p.candidate)) || typeof p.sdp === 'string' && /a=candidate:[^\r\n]* typ relay(?: |[\r\n]|$)/.test(p.sdp)) {
      this.reject(ws, 'relay_disabled', 'Somente P2P direto é permitido. Relay/TURN está desativado.'); return;
    }
    const payload = p.kind === 'ice'
      ? { kind: p.kind, candidate: p.candidate, sdpMid: p.sdpMid, sdpMLineIndex: p.sdpMLineIndex }
      : { kind: p.kind, sdp: p.sdp };
    this.send(target.ws, { type: 'signal', from: s.id, payload: { ...payload, streamId: p.streamId, subscriptionId: p.subscriptionId, session: p.session } });
  }
  private async depart(ws: WebSocket) {
    const s = ws.deserializeAttachment() as Session;
    this.clearSubscriptions(s.id);
    ws.serializeAttachment({ ...s, role: undefined, streamId: undefined, watching: [] });
    if (s.role === 'host' && !this.metadata?.persistent) await this.end('O criador encerrou a sala.');
    else this.broadcast();
  }
  async webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean) {
    await this.depart(ws);
    ws.close(code === 1006 ? 1000 : code, 'closed');
  }
  async webSocketError(ws: WebSocket, _error: unknown) { await this.depart(ws); ws.close(1011, 'connection_error'); }
  private async end(reason: string) {
    this.metadata = undefined;
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, { type: 'room_closed', message: reason });
      ws.serializeAttachment({ ...ws.deserializeAttachment(), role: undefined });
      ws.close(1000, 'room_closed');
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
  async alarm() {
    if (!this.metadata || Date.now() >= this.metadata.expiresAt) { await this.end('Sala expirada.'); return; }
    for (const ws of this.ctx.getWebSockets()) {
      const s = ws.deserializeAttachment() as Session;
      if (stale(s.lastSeen, this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime(), Boolean(s.role), Date.now())) {
        await this.depart(ws); ws.close(1008, 'timeout');
      }
    }
    if (this.metadata) {
      if (this.ctx.getWebSockets().length) await this.ctx.storage.setAlarm(Math.min(Date.now() + SWEEP_INTERVAL, this.metadata.expiresAt));
      else if (this.metadata.persistent) await this.ctx.storage.deleteAlarm();
      else await this.ctx.storage.setAlarm(this.metadata.expiresAt);
    }
  }
}
