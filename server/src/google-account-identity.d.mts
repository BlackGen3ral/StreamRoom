export const androidAudience: string;
export function accountRoomKey(subject: string, secret: string): Promise<string>;
export function verifyGoogleAccountIdentity(token: unknown, options: {
  audience: string;
  expectedNonce: string;
}): Promise<{ subject: string; name: string; picture: string | null }>;
