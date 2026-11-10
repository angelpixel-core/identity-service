import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { GoogleOidcAdapter } from '../../../../../src/contexts/identity/infrastructure/federation/google_oidc_adapter';
import { JsonWebKey } from '../../../../../src/contexts/identity/infrastructure/federation/jwks_token_verifier';

describe('Unit: GoogleOidcAdapter (Google IdP Connector)', () => {
  let testPrivateKeyPem: string;
  let testKid = 'unit-google-key-1';
  let testJwk: JsonWebKey;

  beforeAll(() => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    testPrivateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const jwk = publicKey.export({ format: 'jwk' }) as any;
    testJwk = {
      ...jwk,
      kid: testKid,
      use: 'sig',
      alg: 'RS256',
    };
  });

  describe('getAuthorizationUrl', () => {
    it('should generate Google OAuth 2.0 authorization URL with default consent prompt', async () => {
      const adapter = new GoogleOidcAdapter({
        clientId: 'my-google-client-id',
        clientSecret: 'my-google-secret',
      });

      const urlString = await adapter.getAuthorizationUrl({
        tenantId: 'tenant-1',
        clientId: 'app-client',
        redirectUri: 'https://app.io/cb',
        state: 'st-123',
        nonce: 'nc-456',
      });

      const url = new URL(urlString);
      expect(url.origin).toBe('https://accounts.google.com');
      expect(url.pathname).toBe('/o/oauth2/v2/auth');
      expect(url.searchParams.get('client_id')).toBe('my-google-client-id');
      expect(url.searchParams.get('redirect_uri')).toBe('https://app.io/cb');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('scope')).toBe('openid email profile');
      expect(url.searchParams.get('state')).toBe('st-123');
      expect(url.searchParams.get('nonce')).toBe('nc-456');
      expect(url.searchParams.get('access_type')).toBe('offline');
      expect(url.searchParams.get('prompt')).toBe('consent');
    });

    it('should include login_hint and custom prompt when provided', async () => {
      const adapter = new GoogleOidcAdapter({
        clientId: 'my-google-client-id',
        clientSecret: 'my-google-secret',
      });

      const urlString = await adapter.getAuthorizationUrl({
        tenantId: 'tenant-1',
        redirectUri: 'https://app.io/cb',
        state: 'st-123',
        nonce: 'nc-456',
        prompt: 'select_account',
        loginHint: 'user@gmail.com',
      });

      const url = new URL(urlString);
      expect(url.searchParams.get('prompt')).toBe('select_account');
      expect(url.searchParams.get('login_hint')).toBe('user@gmail.com');
    });
  });

  describe('exchangeCodeAndVerifyToken', () => {
    it('should exchange code and return normalized profile', async () => {
      const mockFetch = jest.fn().mockImplementation(async (url: string) => {
        if (url.includes('token')) {
          const idToken = jwt.sign(
            {
              iss: 'https://accounts.google.com',
              aud: 'google-client-123',
              sub: 'google-user-id-001',
              email: 'john.doe@gmail.com',
              email_verified: true,
              name: 'John Doe',
              picture: 'https://avatar.google.com/john.png',
              nonce: 'matching-nonce',
            },
            testPrivateKeyPem,
            { algorithm: 'RS256', keyid: testKid, expiresIn: '1h' }
          );
          return { id_token: idToken };
        }
        return { keys: [testJwk] };
      });

      const adapter = new GoogleOidcAdapter({
        clientId: 'google-client-123',
        clientSecret: 'google-secret-123',
        httpClient: mockFetch,
      });
      adapter.getTokenVerifier().setKeys([testJwk]);

      const profile = await adapter.exchangeCodeAndVerifyToken({
        code: 'auth-code-123',
        redirectUri: 'https://app.io/cb',
        nonce: 'matching-nonce',
      });

      expect(profile).toEqual({
        provider: 'google',
        externalSubjectId: 'google-user-id-001',
        email: 'john.doe@gmail.com',
        emailVerified: true,
        name: 'John Doe',
        picture: 'https://avatar.google.com/john.png',
        rawClaims: expect.any(Object),
      });
    });

    it('should throw if token response is missing id_token', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ access_token: 'some-token' });
      const adapter = new GoogleOidcAdapter({
        clientId: 'google-client-123',
        clientSecret: 'google-secret-123',
        httpClient: mockFetch,
      });

      await expect(
        adapter.exchangeCodeAndVerifyToken({
          code: 'code-123',
          redirectUri: 'https://app.io/cb',
        })
      ).rejects.toThrow('Google token response did not contain an id_token');
    });

    it('should throw if nonce does not match', async () => {
      const mockFetch = jest.fn().mockImplementation(async () => {
        const idToken = jwt.sign(
          {
            iss: 'https://accounts.google.com',
            aud: 'google-client-123',
            sub: 'user-001',
            email: 'user@gmail.com',
            email_verified: true,
            nonce: 'different-nonce',
          },
          testPrivateKeyPem,
          { algorithm: 'RS256', keyid: testKid, expiresIn: '1h' }
        );
        return { id_token: idToken };
      });

      const adapter = new GoogleOidcAdapter({
        clientId: 'google-client-123',
        clientSecret: 'google-secret-123',
        httpClient: mockFetch,
      });
      adapter.getTokenVerifier().setKeys([testJwk]);

      await expect(
        adapter.exchangeCodeAndVerifyToken({
          code: 'code-123',
          redirectUri: 'https://app.io/cb',
          nonce: 'expected-nonce',
        })
      ).rejects.toThrow('ID Token nonce does not match original request nonce');
    });

    it('should throw if email_verified is false', async () => {
      const mockFetch = jest.fn().mockImplementation(async () => {
        const idToken = jwt.sign(
          {
            iss: 'https://accounts.google.com',
            aud: 'google-client-123',
            sub: 'user-001',
            email: 'unverified@gmail.com',
            email_verified: false,
          },
          testPrivateKeyPem,
          { algorithm: 'RS256', keyid: testKid, expiresIn: '1h' }
        );
        return { id_token: idToken };
      });

      const adapter = new GoogleOidcAdapter({
        clientId: 'google-client-123',
        clientSecret: 'google-secret-123',
        httpClient: mockFetch,
      });
      adapter.getTokenVerifier().setKeys([testJwk]);

      await expect(
        adapter.exchangeCodeAndVerifyToken({
          code: 'code-123',
          redirectUri: 'https://app.io/cb',
        })
      ).rejects.toThrow('Google account email is not verified');
    });

    it('should throw if email claim is absent', async () => {
      const mockFetch = jest.fn().mockImplementation(async () => {
        const idToken = jwt.sign(
          {
            iss: 'https://accounts.google.com',
            aud: 'google-client-123',
            sub: 'user-001',
            email_verified: true,
          },
          testPrivateKeyPem,
          { algorithm: 'RS256', keyid: testKid, expiresIn: '1h' }
        );
        return { id_token: idToken };
      });

      const adapter = new GoogleOidcAdapter({
        clientId: 'google-client-123',
        clientSecret: 'google-secret-123',
        httpClient: mockFetch,
      });
      adapter.getTokenVerifier().setKeys([testJwk]);

      await expect(
        adapter.exchangeCodeAndVerifyToken({
          code: 'code-123',
          redirectUri: 'https://app.io/cb',
        })
      ).rejects.toThrow('Google account profile did not include an email');
    });
  });
});
