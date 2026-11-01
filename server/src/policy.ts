// Pure lease/cleanup rules; no timers, tokens or network side effects.
export const ROOM_TTL = 24 * 60 * 60 * 1000;
export const RENEW_WINDOW = 60 * 60 * 1000;
export const SWEEP_INTERVAL = 5 * 60 * 1000;
export function renewalExpiry(expiresAt: number, now: number): number {
  if (now >= expiresAt) throw new Error('Expired room cannot be renewed');
  return expiresAt - now <= RENEW_WINDOW ? now + ROOM_TTL : expiresAt;
}
export function stale(lastSeen: number, autoResponseAt: number | undefined, authenticated: boolean, now: number): boolean {
  return now - Math.max(lastSeen, authenticated ? autoResponseAt ?? 0 : 0) > (authenticated ? 90_000 : 15_000);
}
