import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { GoogleOidcAdapter } from '../../../../../src/contexts/identity/infrastructure/federation/google_oidc_adapter';
import { JsonWebKey } from '../../../../../src/contexts/identity/infrastructure/federation/jwks_token_verifier';

describe('Integration: GoogleOidcAdapter (US-10)', () => {
  let adapter: GoogleOidcAdapter;
  let testPrivateKeyPem: string;
  let testKid = 'google-test-key-1';
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

  const createMockAdapter = (customClaims?: Record<string, any>, tokenResponseOverride?: any) => {
    const mockHttpClient = async (url: string, _init?: any) => {
      if (url.includes('token')) {
        if (tokenResponseOverride) {
          return tokenResponseOverride;
        }

        const idToken = jwt.sign(
          {
            iss: 'https://accounts.google.com',
            aud: 'test-google-client-id',
            sub: 'google-sub-999',
            email: 'dev@acme.com',
            email_verified: true,
            name: 'Dev Acme',
            picture: 'https://avatar.google.com/dev.jpg',
            nonce: 'expected-nonce-abc',
            ...customClaims,
          },
          testPrivateKeyPem,
          {
            algorithm: 'RS256',
            keyid: testKid,
            expiresIn: '1h',
          }
        );

        return {
          id_token: idToken,
          access_token: 'google-access-token-123',
          token_type: 'Bearer',
        };
      }

      if (url.includes('certs')) {
        return { keys: [testJwk] };
      }

      return {};
    };

    const inst = new GoogleOidcAdapter({
      clientId: 'test-google-client-id',
      clientSecret: 'test-google-client-secret',
      httpClient: mockHttpClient,
    });
    inst.getTokenVerifier().setKeys([testJwk]);
    return inst;
  };

  it('should generate a valid Google authorization URL with all required query params', async () => {
    adapter = createMockAdapter();
    const urlString = await adapter.getAuthorizationUrl({
      tenantId: 'tenant-omega',
      clientId: 'client-spa',
      redirectUri: 'https://omega.local/cb',
      state: 'state-val-123',
      nonce: 'nonce-val-456',
      prompt: 'select_account',
      loginHint: 'user@omega.local',
    });

    const url = new URL(urlString);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.pathname).toBe('/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('test-google-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('https://omega.local/cb');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('state')).toBe('state-val-123');
    expect(url.searchParams.get('nonce')).toBe('nonce-val-456');
    expect(url.searchParams.get('prompt')).toBe('select_account');
    expect(url.searchParams.get('login_hint')).toBe('user@omega.local');
  });

  it('should exchange code and return normalized profile for valid Google response', async () => {
    adapter = createMockAdapter();
    const profile = await adapter.exchangeCodeAndVerifyToken({
      code: 'code-123',
      redirectUri: 'https://omega.local/cb',
      nonce: 'expected-nonce-abc',
    });

    expect(profile.provider).toBe('google');
    expect(profile.externalSubjectId).toBe('google-sub-999');
    expect(profile.email).toBe('dev@acme.com');
    expect(profile.emailVerified).toBe(true);
    expect(profile.name).toBe('Dev Acme');
    expect(profile.picture).toBe('https://avatar.google.com/dev.jpg');
    expect(profile.rawClaims).toBeDefined();
  });

  it('should reject when token endpoint returns no id_token', async () => {
    adapter = createMockAdapter(undefined, { access_token: 'only-access' });
    await expect(
      adapter.exchangeCodeAndVerifyToken({
        code: 'code-123',
        redirectUri: 'https://omega.local/cb',
      })
    ).rejects.toThrow('Google token response did not contain an id_token');
  });

  it('should reject when nonce in token does not match request nonce', async () => {
    adapter = createMockAdapter({ nonce: 'other-nonce' });
    await expect(
      adapter.exchangeCodeAndVerifyToken({
        code: 'code-123',
        redirectUri: 'https://omega.local/cb',
        nonce: 'expected-nonce-abc',
      })
    ).rejects.toThrow('ID Token nonce does not match original request nonce');
  });

  it('should reject when email_verified claim is false', async () => {
    adapter = createMockAdapter({ email_verified: false });
    await expect(
      adapter.exchangeCodeAndVerifyToken({
        code: 'code-123',
        redirectUri: 'https://omega.local/cb',
      })
    ).rejects.toThrow('Google account email is not verified');
  });

  it('should reject when token is signed by an unrecognized key', async () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const foreignKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

    const mockHttpClient = async (url: string) => {
      if (url.includes('token')) {
        const idToken = jwt.sign(
          {
            iss: 'https://accounts.google.com',
            aud: 'test-google-client-id',
            sub: 'sub-unknown',
            email: 'fake@acme.com',
            email_verified: true,
          },
          foreignKeyPem,
          {
            algorithm: 'RS256',
            keyid: 'unknown-kid-999',
            expiresIn: '1h',
          }
        );
        return { id_token: idToken };
      }
      return { keys: [testJwk] };
    };

    adapter = new GoogleOidcAdapter({
      clientId: 'test-google-client-id',
      clientSecret: 'test-google-client-secret',
      httpClient: mockHttpClient,
    });
    adapter.getTokenVerifier().setKeys([testJwk]);

    await expect(
      adapter.exchangeCodeAndVerifyToken({
        code: 'code-123',
        redirectUri: 'https://omega.local/cb',
      })
    ).rejects.toThrow('key ID "unknown-kid-999" not found in JWKS');
  });
});
