export type ClientConfigEnv = { DEFAULT_ZEROTIER_NETWORK_ID?: string; GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string };

// Public identifiers only. Never serialize env, room tokens or provider credentials.
export function clientConfig(env: ClientConfigEnv) {
  return {
    version: 1,
    googleTokenExchangeReady: typeof env.GOOGLE_CLIENT_SECRET === 'string' && env.GOOGLE_CLIENT_SECRET.length > 0 && typeof env.GOOGLE_CLIENT_ID === 'string' && /^[0-9]+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(env.GOOGLE_CLIENT_ID),
    defaultZeroTierNetworkId: typeof env.DEFAULT_ZEROTIER_NETWORK_ID === 'string' && /^[a-f0-9]{16}$/.test(env.DEFAULT_ZEROTIER_NETWORK_ID) ? env.DEFAULT_ZEROTIER_NETWORK_ID : '',
    googleClientId: typeof env.GOOGLE_CLIENT_ID === 'string' && /^[0-9]+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(env.GOOGLE_CLIENT_ID) && env.GOOGLE_CLIENT_ID.length <= 256 ? env.GOOGLE_CLIENT_ID : ''
  };
}
