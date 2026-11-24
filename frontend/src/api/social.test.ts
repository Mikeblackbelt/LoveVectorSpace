import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { json } from '../test/utils';
import { setNativeOverride, setTransport } from './client';
import { googleStartUrl, serverNonce, sha256Hex } from './social';

beforeEach(() => setNativeOverride(false));
afterEach(() => setNativeOverride(null));

describe('social sign-in nonce', () => {
  it('fetches a single-use nonce from the server', async () => {
    const calls: { url: string; method: string }[] = [];
    setTransport(async (url, init) => {
      calls.push({ url, method: (init.method || 'GET').toUpperCase() });
      return json({ nonce: 'srv-nonce-1', expires_in: 600 });
    });
    await expect(serverNonce()).resolves.toBe('srv-nonce-1');
    expect(calls).toEqual([{ url: '/api/auth/nonce', method: 'POST' }]);
  });

  it('hashes the nonce for Apple as lower-case sha256 hex', async () => {
    await expect(sha256Hex('abc')).resolves.toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('keeps the Google web start URL', () => {
    expect(googleStartUrl('/people', 'LVS-1')).toBe('/api/auth/google/start?invite=LVS-1&redirect=%2Fpeople');
  });
});
