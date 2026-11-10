import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { MicrosoftEntraAdapter } from '../../../../../src/contexts/identity/infrastructure/federation/microsoft_entra_adapter';
import { JsonWebKey } from '../../../../../src/contexts/identity/infrastructure/federation/jwks_token_verifier';

describe('Unit: MicrosoftEntraAdapter (Microsoft Entra ID Connector)', () => {
  let testPrivateKeyPem: string;
  let testKid = 'unit-msft-key-1';
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
    it('should generate Microsoft authorization URL with default common tenant', async () => {
      const adapter = new MicrosoftEntraAdapter({
        clientId: 'msft-app-id-123',
        clientSecret: 'msft-secret-123',
      });

      const urlString = await adapter.getAuthorizationUrl({
        tenantId: 'tenant-1',
        redirectUri: 'https://app.io/cb',
        state: 'st-msft',
        nonce: 'nc-msft',
      });

      const url = new URL(urlString);
      expect(url.origin).toBe('https://login.microsoftonline.com');
      expect(url.pathname).toBe('/common/oauth2/v2.0/authorize');
      expect(url.searchParams.get('client_id')).toBe('msft-app-id-123');
      expect(url.searchParams.get('redirect_uri')).toBe('https://app.io/cb');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('response_mode')).toBe('query');
      expect(url.searchParams.get('scope')).toBe('openid email profile User.Read');
      expect(url.searchParams.get('state')).toBe('st-msft');
      expect(url.searchParams.get('nonce')).toBe('nc-msft');
    });

    it('should use custom tenant when configured in options', async () => {
      const adapter = new MicrosoftEntraAdapter({
        clientId: 'msft-app-id-123',
        clientSecret: 'msft-secret-123',
        tenant: 'my-corp-tenant-uuid',
      });

      const urlString = await adapter.getAuthorizationUrl({
        tenantId: 'tenant-1',
        redirectUri: 'https://app.io/cb',
        state: 'st-msft',
        nonce: 'nc-msft',
      });

      const url = new URL(urlString);
      expect(url.pathname).toBe('/my-corp-tenant-uuid/oauth2/v2.0/authorize');
    });
  });

  describe('exchangeCodeAndVerifyToken', () => {
    it('should exchange code and normalize user profile using preferred_username and oid', async () => {
      const mockFetch = jest.fn().mockImplementation(async (url: string) => {
        if (url.includes('token')) {
          const idToken = jwt.sign(
            {
              aud: 'msft-app-id-123',
              oid: 'msft-oid-999',
              preferred_username: 'clara@microsoft.com',
              name: 'Clara Oswald',
              nonce: 'msft-nonce-1',
            },
            testPrivateKeyPem,
            { algorithm: 'RS256', keyid: testKid, expiresIn: '1h' }
          );
          return { id_token: idToken };
        }
        return { keys: [testJwk] };
      });

      const adapter = new MicrosoftEntraAdapter({
        clientId: 'msft-app-id-123',
        clientSecret: 'msft-secret-123',
        httpClient: mockFetch,
      });
      adapter.getTokenVerifier().setKeys([testJwk]);

      const profile = await adapter.exchangeCodeAndVerifyToken({
        code: 'code-msft-1',
        redirectUri: 'https://app.io/cb',
        nonce: 'msft-nonce-1',
      });

      expect(profile).toEqual({
        provider: 'microsoft',
        externalSubjectId: 'msft-oid-999',
        email: 'clara@microsoft.com',
        emailVerified: true,
        name: 'Clara Oswald',
        picture: undefined,
        rawClaims: expect.any(Object),
      });
    });

    it('should fallback to upn and sub when preferred_username and oid are missing', async () => {
      const mockFetch = jest.fn().mockImplementation(async () => {
        const idToken = jwt.sign(
          {
            aud: 'msft-app-id-123',
            sub: 'msft-sub-777',
            upn: 'doctor@tardis.com',
            name: 'The Doctor',
          },
          testPrivateKeyPem,
          { algorithm: 'RS256', keyid: testKid, expiresIn: '1h' }
        );
        return { id_token: idToken };
      });

      const adapter = new MicrosoftEntraAdapter({
        clientId: 'msft-app-id-123',
        clientSecret: 'msft-secret-123',
        httpClient: mockFetch,
      });
      adapter.getTokenVerifier().setKeys([testJwk]);

      const profile = await adapter.exchangeCodeAndVerifyToken({
        code: 'code-msft-2',
        redirectUri: 'https://app.io/cb',
      });

      expect(profile.externalSubjectId).toBe('msft-sub-777');
      expect(profile.email).toBe('doctor@tardis.com');
    });

    it('should throw when no email is present in claims', async () => {
      const mockFetch = jest.fn().mockImplementation(async () => {
        const idToken = jwt.sign(
          {
            aud: 'msft-app-id-123',
            sub: 'sub-no-email',
          },
          testPrivateKeyPem,
          { algorithm: 'RS256', keyid: testKid, expiresIn: '1h' }
        );
        return { id_token: idToken };
      });

      const adapter = new MicrosoftEntraAdapter({
        clientId: 'msft-app-id-123',
        clientSecret: 'msft-secret-123',
        httpClient: mockFetch,
      });
      adapter.getTokenVerifier().setKeys([testJwk]);

      await expect(
        adapter.exchangeCodeAndVerifyToken({
          code: 'code-msft-3',
          redirectUri: 'https://app.io/cb',
        })
      ).rejects.toThrow('Microsoft Entra account profile did not include an email');
    });

    it('should throw when no oid or sub is present in claims', async () => {
      const mockFetch = jest.fn().mockImplementation(async () => {
        const idToken = jwt.sign(
          {
            aud: 'msft-app-id-123',
            email: 'user@corp.com',
          },
          testPrivateKeyPem,
          { algorithm: 'RS256', keyid: testKid, expiresIn: '1h' }
        );
        return { id_token: idToken };
      });

      const adapter = new MicrosoftEntraAdapter({
        clientId: 'msft-app-id-123',
        clientSecret: 'msft-secret-123',
        httpClient: mockFetch,
      });
      adapter.getTokenVerifier().setKeys([testJwk]);

      await expect(
        adapter.exchangeCodeAndVerifyToken({
          code: 'code-msft-4',
          redirectUri: 'https://app.io/cb',
        })
      ).rejects.toThrow('Microsoft Entra account profile did not include an oid or sub');
    });
  });
});
