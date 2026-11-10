import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import util from 'util';
import {
  JwksTokenVerifier,
  JsonWebKey,
} from '../../../../../src/contexts/identity/infrastructure/federation/jwks_token_verifier';

describe('Unit: JwksTokenVerifier (JWKS Cache, Auto-Refresh & Retry)', () => {
  let testPrivateKeyPem: string;
  let testKid = 'unit-jwks-key-1';
  let testJwk: JsonWebKey;

  beforeAll(() => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    testPrivateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const jwk = publicKey.export({ format: 'jwk' }) as any;
    testJwk = {
      ...jwk,
      kid: testKid,
      use: 'sig',
      alg: 'RS256',
    };
  });

  describe('Cache and Keys Management', () => {
    it('should set keys and report cachedKeysCount accurately', () => {
      const verifier = new JwksTokenVerifier({
        jwksUri: 'https://test.local/jwks.json',
      });

      expect(verifier.getCachedKeysCount()).toBe(0);
      verifier.setKeys([testJwk]);
      expect(verifier.getCachedKeysCount()).toBe(1);
    });

    it('should return cached key when kid is present and cache is valid', async () => {
      const verifier = new JwksTokenVerifier({
        jwksUri: 'https://test.local/jwks.json',
      });
      verifier.setKeys([testJwk]);

      const keyObject = await verifier.getKey(testKid);
      expect(keyObject).not.toBeNull();
      expect(keyObject?.asymmetricKeyType).toBe('rsa');
    });

    it('should trigger refresh on kid miss when cooldown has elapsed', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        keys: [testJwk],
      });

      const verifier = new JwksTokenVerifier({
        jwksUri: 'https://test.local/jwks.json',
        httpClient: mockFetch,
        minRefreshIntervalMs: 0, // no cooldown for test
      });

      const keyObject = await verifier.getKey(testKid);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(keyObject).not.toBeNull();
      expect(verifier.getCachedKeysCount()).toBe(1);
    });

    it('should not refresh excessively within cooldown window on missing kid', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        keys: [testJwk],
      });

      const verifier = new JwksTokenVerifier({
        jwksUri: 'https://test.local/jwks.json',
        httpClient: mockFetch,
        minRefreshIntervalMs: 5000, // 5s cooldown
      });

      // First call triggers refresh
      await verifier.getKey('non-existent-kid-1');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call within cooldown should NOT trigger a second fetch
      await verifier.getKey('non-existent-kid-2');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should retry with exponential backoff when httpClient throws transient error', async () => {
      let callCount = 0;
      const mockFetch = jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('503 Service Unavailable');
        }
        return { keys: [testJwk] };
      });

      const verifier = new JwksTokenVerifier({
        jwksUri: 'https://test.local/jwks.json',
        httpClient: mockFetch,
        maxRetries: 3,
        initialRetryDelayMs: 10,
      });

      await verifier.refreshKeys();
      expect(callCount).toBe(3);
      expect(verifier.getCachedKeysCount()).toBe(1);
    });

    it('should fail with comprehensive message when max retries are exceeded', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('Connection timed out'));

      const verifier = new JwksTokenVerifier({
        jwksUri: 'https://test.local/jwks.json',
        httpClient: mockFetch,
        maxRetries: 2,
        initialRetryDelayMs: 5,
      });

      await expect(verifier.refreshKeys()).rejects.toThrow(
        'JWKS refresh failed after 2 attempts: Connection timed out'
      );
    });

    it('should preserve previously cached keys if refresh fails (fail-safe)', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('Network down'));

      const verifier = new JwksTokenVerifier({
        jwksUri: 'https://test.local/jwks.json',
        httpClient: mockFetch,
        maxRetries: 1,
        initialRetryDelayMs: 5,
        minRefreshIntervalMs: 0,
      });
      verifier.setKeys([testJwk]);

      // When requesting the known key, even if refresh fails, it returns the cached key
      const key = await verifier.getKey(testKid);
      expect(key).not.toBeNull();
    });
  });

  describe('verifyIdToken', () => {
    let verifier: JwksTokenVerifier;

    beforeEach(() => {
      verifier = new JwksTokenVerifier({
        jwksUri: 'https://test.local/jwks.json',
      });
      verifier.setKeys([testJwk]);
    });

    it('should verify a valid RS256 token and return decoded payload', async () => {
      const token = jwt.sign(
        {
          iss: 'https://accounts.google.com',
          aud: 'my-client-app',
          sub: 'sub-12345',
          email: 'user@acme.com',
        },
        testPrivateKeyPem,
        {
          algorithm: 'RS256',
          keyid: testKid,
          expiresIn: '10m',
        }
      );

      const payload = await verifier.verifyIdToken(token, 'my-client-app', 'https://accounts.google.com');
      expect(payload).toHaveProperty('sub', 'sub-12345');
      expect(payload).toHaveProperty('email', 'user@acme.com');
    });

    it('should reject when token is missing kid header', async () => {
      const tokenWithoutKid = jwt.sign(
        { sub: 'sub-no-kid' },
        testPrivateKeyPem,
        {
          algorithm: 'RS256',
          expiresIn: '10m',
        }
      );

      await expect(verifier.verifyIdToken(tokenWithoutKid)).rejects.toThrow(
        'Invalid token: missing "kid" header'
      );
    });

    it('should reject when kid is unknown and cannot be fetched', async () => {
      const token = jwt.sign(
        { sub: 'sub-123' },
        testPrivateKeyPem,
        {
          algorithm: 'RS256',
          keyid: 'unknown-key-id',
          expiresIn: '10m',
        }
      );

      await expect(verifier.verifyIdToken(token)).rejects.toThrow(
        'key ID "unknown-key-id" not found in JWKS'
      );
    });

    it('should reject when audience does not match expectedAudience', async () => {
      const token = jwt.sign(
        { aud: 'wrong-audience', sub: 'sub-123' },
        testPrivateKeyPem,
        {
          algorithm: 'RS256',
          keyid: testKid,
          expiresIn: '10m',
        }
      );

      await expect(verifier.verifyIdToken(token, 'expected-audience')).rejects.toThrow(
        'jwt audience invalid'
      );
    });

    it('should reject when token has expired', async () => {
      const expiredToken = jwt.sign(
        { sub: 'sub-expired' },
        testPrivateKeyPem,
        {
          algorithm: 'RS256',
          keyid: testKid,
          expiresIn: '-10s',
        }
      );

      await expect(verifier.verifyIdToken(expiredToken)).rejects.toThrow(
        'jwt expired'
      );
    });

    it('should format toString and inspect safely', () => {
      expect(verifier.toString()).toContain('JwksTokenVerifier');
      expect(util.inspect(verifier)).toContain('cachedKeys: 1');
    });
  });
});
