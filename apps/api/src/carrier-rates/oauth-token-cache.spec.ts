import { OAuthTokenCache } from './oauth-token-cache';

describe('OAuthTokenCache', () => {
  it('reuses a cached token until it expires', async () => {
    const cache = new OAuthTokenCache();
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return { accessToken: `tok-${calls}`, expiresInSec: 3600 };
    };
    expect(await cache.getToken('k', fetcher)).toBe('tok-1');
    expect(await cache.getToken('k', fetcher)).toBe('tok-1');
    expect(calls).toBe(1);
  });

  it('refetches when the token is past the refresh buffer', async () => {
    const cache = new OAuthTokenCache();
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      // expires_in smaller than the 60s buffer => treated as expired.
      return { accessToken: `tok-${calls}`, expiresInSec: 30 };
    };
    expect(await cache.getToken('k', fetcher)).toBe('tok-1');
    expect(await cache.getToken('k', fetcher)).toBe('tok-2');
    expect(calls).toBe(2);
  });
});
