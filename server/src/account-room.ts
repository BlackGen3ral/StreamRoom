import { DurableObject } from 'cloudflare:workers';
import { accountRoomKey, androidAudience, verifyGoogleAccountIdentity } from './google-account-identity.mjs';
import { clientConfig, type ClientConfigEnv } from './client-config';

type Room = { roomId: string; participantId: string; expiresAt: number };
type SyncEnv = Env & ClientConfigEnv & { ROOM_SYNC_SECRET?: string };
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export class ActiveAccountRoom extends DurableObject<Env> {
  async setRoom(room: Room) {
    await this.ctx.storage.put('room', room);
    await this.ctx.storage.setAlarm(room.expiresAt);
  }

  async current(): Promise<Room | null> {
    const room = await this.ctx.storage.get<Room>('room');
    return room && room.expiresAt > Date.now() ? room : null;
  }

  async alarm() {
    await this.ctx.storage.transaction(async tx => {
      const room = await tx.get<Room>('room');
      if (room && room.expiresAt <= Date.now()) await tx.delete('room');
    });
  }
}

export async function accountRoomRequest(request: Request, env: SyncEnv): Promise<Response> {
  const secret = env.ROOM_SYNC_SECRET;
  if (!secret || secret.length < 32) return reply({ error: 'sync_unavailable' }, 503);
  if (request.headers.has('Origin')) return reply({ error: 'invalid_request' }, 400);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  if (!(await env.CREATE_LIMITER.limit({ key: 'room-sync:' + ip })).success) return reply({ error: 'rate_limited' }, 429);
  const length = Number(request.headers.get('Content-Length'));
  if (!Number.isSafeInteger(length) || length < 1 || length > 12_000) return reply({ error: 'invalid_request' }, 400);
  try {
    const raw = await request.text();
    if (raw.length > 12_000) return reply({ error: 'invalid_request' }, 400);
    const { operation, credential, nonce, roomId, participantId, inviteToken } = JSON.parse(raw);
    if (!['publish', 'find'].includes(operation) || typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{22,128}$/.test(nonce)) {
      return reply({ error: 'invalid_request' }, 400);
    }
    const audience = operation === 'publish' ? clientConfig(env).googleClientId : androidAudience;
    const identity = await verifyGoogleAccountIdentity(credential, { audience, expectedNonce: nonce });
    const account = env.ACTIVE_ACCOUNT_ROOMS.getByName(await accountRoomKey(identity.subject, secret));
    if (operation === 'publish') {
      if (typeof roomId !== 'string' || !uuid.test(roomId) ||
          typeof participantId !== 'string' || !uuid.test(participantId) ||
          typeof inviteToken !== 'string' || !/^[a-f0-9]{64}$/.test(inviteToken)) {
        return reply({ error: 'invalid_room' }, 400);
      }
      if (!await env.MULTI_ROOMS.getByName(roomId).canResume(participantId, inviteToken)) {
        return reply({ error: 'room_unavailable' }, 404);
      }
      await account.setRoom({ roomId, participantId, expiresAt: Date.now() + 60_000 });
      return reply({ active: true });
    }
    const room = await account.current();
    const grant = room ? await env.MULTI_ROOMS.getByName(room.roomId).issueResumeGrant(room.participantId) : null;
    if (!room || !grant) {
      return reply({ active: false });
    }
    return reply({ active: true, invitation: 'https://streamroom.arthostudio.com/invite/' + room.roomId + '#' + grant });
  } catch {
    return reply({ error: 'invalid_identity' }, 401);
  }
}
