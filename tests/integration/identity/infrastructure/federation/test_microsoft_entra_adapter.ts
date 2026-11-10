import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { MicrosoftEntraAdapter } from '../../../../../src/contexts/identity/infrastructure/federation/microsoft_entra_adapter';
import { JsonWebKey } from '../../../../../src/contexts/identity/infrastructure/federation/jwks_token_verifier';

describe('Integration: MicrosoftEntraAdapter (US-10)', () => {
  let adapter: MicrosoftEntraAdapter;
  let testPrivateKeyPem: string;
  let testKid = 'msft-test-key-1';
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

  const createMockAdapter = (customClaims?: Record<string, any>) => {
    const mockHttpClient = async (url: string) => {
      if (url.includes('token')) {
        const idToken = jwt.sign(
          {
            iss: 'https://login.microsoftonline.com/tenant-123/v2.0',
            aud: 'test-msft-client-id',
            oid: 'msft-oid-777',
            preferred_username: 'engineer@corp.microsoft.com',
            name: 'Corp Engineer',
            nonce: 'msft-nonce-xyz',
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
          access_token: 'msft-access-token-999',
          token_type: 'Bearer',
        };
      }

      if (url.includes('keys')) {
        return { keys: [testJwk] };
      }

      return {};
    };

    const inst = new MicrosoftEntraAdapter({
      clientId: 'test-msft-client-id',
      clientSecret: 'test-msft-client-secret',
      tenant: 'corp-tenant-id',
      httpClient: mockHttpClient,
    });
    inst.getTokenVerifier().setKeys([testJwk]);
    return inst;
  };

  it('should generate a valid Microsoft Entra authorization URL', async () => {
    adapter = createMockAdapter();
    const urlString = await adapter.getAuthorizationUrl({
      tenantId: 'tenant-beta',
      redirectUri: 'https://beta.local/cb',
      state: 'msft-state-1',
      nonce: 'msft-nonce-1',
      prompt: 'consent',
    });

    const url = new URL(urlString);
    expect(url.origin).toBe('https://login.microsoftonline.com');
    expect(url.pathname).toBe('/corp-tenant-id/oauth2/v2.0/authorize');
    expect(url.searchParams.get('client_id')).toBe('test-msft-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('https://beta.local/cb');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('response_mode')).toBe('query');
    expect(url.searchParams.get('scope')).toBe('openid email profile User.Read');
    expect(url.searchParams.get('state')).toBe('msft-state-1');
    expect(url.searchParams.get('nonce')).toBe('msft-nonce-1');
  });

  it('should exchange code and normalize user profile with oid and preferred_username', async () => {
    adapter = createMockAdapter();
    const profile = await adapter.exchangeCodeAndVerifyToken({
      code: 'code-msft-1',
      redirectUri: 'https://beta.local/cb',
      nonce: 'msft-nonce-xyz',
    });

    expect(profile.provider).toBe('microsoft');
    expect(profile.externalSubjectId).toBe('msft-oid-777');
    expect(profile.email).toBe('engineer@corp.microsoft.com');
    expect(profile.emailVerified).toBe(true);
    expect(profile.name).toBe('Corp Engineer');
  });

  it('should fallback to upn or email claim if preferred_username is absent', async () => {
    adapter = createMockAdapter({
      preferred_username: undefined,
      upn: 'upn.user@corp.com',
      sub: 'msft-sub-888',
      oid: undefined,
    });

    const profile = await adapter.exchangeCodeAndVerifyToken({
      code: 'code-msft-2',
      redirectUri: 'https://beta.local/cb',
    });

    expect(profile.email).toBe('upn.user@corp.com');
    expect(profile.externalSubjectId).toBe('msft-sub-888');
  });

  it('should reject when ID token nonce does not match original request', async () => {
    adapter = createMockAdapter({ nonce: 'other-nonce' });
    await expect(
      adapter.exchangeCodeAndVerifyToken({
        code: 'code-msft-3',
        redirectUri: 'https://beta.local/cb',
        nonce: 'msft-nonce-xyz',
      })
    ).rejects.toThrow('ID Token nonce does not match original request nonce');
  });
});

