import crypto from 'crypto';
import util from 'util';
import jwt from 'jsonwebtoken';

export interface JsonWebKey {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  n: string;
  e: string;
  [key: string]: any;
}

export interface JwksResponse {
  keys: JsonWebKey[];
}

export type HttpFetchFn = (url: string, options?: any) => Promise<any>;

export interface JwksTokenVerifierOptions {
  jwksUri: string;
  cacheTtlMs?: number;
  minRefreshIntervalMs?: number;
  maxRetries?: number;
  initialRetryDelayMs?: number;
  httpClient?: HttpFetchFn;
}

export class JwksTokenVerifier {
  private readonly jwksUri: string;
  private readonly cacheTtlMs: number;
  private readonly minRefreshIntervalMs: number;
  private readonly maxRetries: number;
  private readonly initialRetryDelayMs: number;
  private readonly httpClient: HttpFetchFn;
  private cachedKeys: Map<string, crypto.KeyObject> = new Map();
  private cacheExpiresAt: number = 0;
  private lastRefreshAttempt: number = 0;

  constructor(options: JwksTokenVerifierOptions) {
    this.jwksUri = options.jwksUri;
    this.cacheTtlMs = options.cacheTtlMs ?? 3600000; // 1 hour default
    this.minRefreshIntervalMs = options.minRefreshIntervalMs ?? 5000; // 5 seconds cooldown
    this.maxRetries = options.maxRetries ?? 3;
    this.initialRetryDelayMs = options.initialRetryDelayMs ?? 100;

    this.httpClient = options.httpClient || (async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to fetch JWKS from ${url}: HTTP ${res.status}`);
      }
      return res.json();
    });
  }

  /**
   * Directly sets keys in the cache (useful for mocking and tests)
   */
  public setKeys(keys: JsonWebKey[]): void {
    this.cachedKeys.clear();
    for (const key of keys) {
      if (key.kid && key.kty === 'RSA') {
        try {
          const keyObject = crypto.createPublicKey({ key, format: 'jwk' });
          this.cachedKeys.set(key.kid, keyObject);
        } catch {
          // ignore malformed keys
        }
      }
    }
    this.cacheExpiresAt = Date.now() + this.cacheTtlMs;
    this.lastRefreshAttempt = Date.now();
  }

  /**
   * Retrieves a public key by Key ID (kid) with auto-refresh on cache miss
   */
  public async getKey(kid: string): Promise<crypto.KeyObject | null> {
    const now = Date.now();

    // 1. Return from cache if present and not expired
    if (this.cachedKeys.has(kid) && now < this.cacheExpiresAt) {
      return this.cachedKeys.get(kid)!;
    }

    // 2. If kid is missing or cache expired, trigger revalidation with cooldown guard
    if (now - this.lastRefreshAttempt >= this.minRefreshIntervalMs) {
      try {
        await this.refreshKeys();
      } catch {
        // Fail-safe: if refresh fails but key was previously in cache, return it
        if (this.cachedKeys.has(kid)) {
          return this.cachedKeys.get(kid)!;
        }
      }
    }

    return this.cachedKeys.get(kid) || null;
  }

  /**
   * Refreshes the public keys from the JWKS URI with retry and exponential backoff
   */
  public async refreshKeys(): Promise<void> {
    this.lastRefreshAttempt = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const data: JwksResponse = await this.httpClient(this.jwksUri);
        if (data && Array.isArray(data.keys)) {
          const newMap = new Map<string, crypto.KeyObject>();
          for (const key of data.keys) {
            if (key.kid && key.kty === 'RSA') {
              try {
                const keyObject = crypto.createPublicKey({ key, format: 'jwk' });
                newMap.set(key.kid, keyObject);
              } catch {
                // ignore invalid individual keys
              }
            }
          }
          this.cachedKeys = newMap;
          this.cacheExpiresAt = Date.now() + this.cacheTtlMs;
          return;
        }
        throw new Error('JWKS response does not contain a valid keys array');
      } catch (err: any) {
        lastError = err;
        if (attempt < this.maxRetries - 1) {
          const delay = this.initialRetryDelayMs * Math.pow(2, attempt) + Math.random() * 20;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(`JWKS refresh failed after ${this.maxRetries} attempts: ${lastError?.message}`);
  }

  /**
   * Verifies an RS256 signed ID token against the JWKS
   */
  public async verifyIdToken<T = any>(
    token: string,
    expectedAudience?: string,
    expectedIssuer?: string | string[]
  ): Promise<T> {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded !== 'object' || !decoded.header) {
      throw new Error('Invalid token structure: unable to decode JWT header');
    }

    const kid = decoded.header.kid;
    if (!kid) {
      throw new Error('Invalid token: missing "kid" header');
    }

    const key = await this.getKey(kid);
    if (!key) {
      throw new Error(`Unable to verify token: key ID "${kid}" not found in JWKS`);
    }

    const pem = key.export({ type: 'spki', format: 'pem' }) as string;

    const verifyOptions: jwt.VerifyOptions = {
      algorithms: ['RS256'],
    };

    if (expectedAudience) {
      verifyOptions.audience = expectedAudience;
    }

    if (expectedIssuer) {
      verifyOptions.issuer = expectedIssuer as string | [string, ...string[]];
    }

    return jwt.verify(token, pem, verifyOptions) as T;
  }

  public getCachedKeysCount(): number {
    return this.cachedKeys.size;
  }

  public toString(): string {
    return `JwksTokenVerifier { jwksUri: "${this.jwksUri}", cachedKeys: ${this.cachedKeys.size} }`;
  }

  public [util.inspect.custom](): string {
    return this.toString();
  }
}
