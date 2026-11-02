import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientConfig } from '../src/client-config.ts';

test('public client config returns only validated identifiers and never provider credentials', () => {
  const config = clientConfig({ DEFAULT_ZEROTIER_NETWORK_ID: '0123456789abcdef', GOOGLE_CLIENT_ID: '123-public.apps.googleusercontent.com', API_TOKEN: 'must-not-leak', TURN_SECRET: 'must-not-leak' });
  assert.deepEqual(config, { version: 1, googleTokenExchangeReady: false, defaultZeroTierNetworkId: '0123456789abcdef', googleClientId: '123-public.apps.googleusercontent.com' });
  assert.equal(JSON.stringify(config).includes('must-not-leak'), false);
  assert.deepEqual(clientConfig({ DEFAULT_ZEROTIER_NETWORK_ID: 'invalid', GOOGLE_CLIENT_ID: 'https://untrusted.example' }), { version: 1, googleTokenExchangeReady: false, defaultZeroTierNetworkId: '', googleClientId: '' });
  assert.deepEqual(clientConfig({}), { version: 1, googleTokenExchangeReady: false, defaultZeroTierNetworkId: '', googleClientId: '' });
});
