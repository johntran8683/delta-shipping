/**
 * In-memory OAuth 2.0 token cache shared by the carrier providers.
 * Tokens are cached until shortly before expiry (refresh buffer 60s) so a
 * burst of quotes reuses one token; cache keys isolate carrier+environment.
 */

export interface TokenFetchResult {
  accessToken: string;
  /** Seconds until expiry, as reported by the token endpoint. */
  expiresInSec: number;
}

const REFRESH_BUFFER_SEC = 60;

export class OAuthTokenCache {
  private readonly cache = new Map<
    string,
    { token: string; expiresAt: number }
  >();

  async getToken(
    key: string,
    fetcher: () => Promise<TokenFetchResult>,
  ): Promise<string> {
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) return cached.token;
    const { accessToken, expiresInSec } = await fetcher();
    const ttl = Math.max(0, expiresInSec - REFRESH_BUFFER_SEC);
    this.cache.set(key, { token: accessToken, expiresAt: now + ttl * 1000 });
    return accessToken;
  }

  clear(key: string): void {
    this.cache.delete(key);
  }
}
