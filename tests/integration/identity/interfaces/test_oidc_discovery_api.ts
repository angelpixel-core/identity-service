import http from 'http';
import request from 'supertest';
import { Express } from 'express';
import jwt from 'jsonwebtoken';
import { createApp } from '../../../../interfaces/http/server';
import { AsymmetricKeyProviderPort, JwksResponseDto } from '../../../../src/contexts/identity/domain/ports/crypto/asymmetric_key_provider_port';

describe('Integration API: OIDC Discovery & JWKS Endpoints (US-07 & RFC 8414 / RFC 7517)', () => {
  let app: Express;
  let server: http.Server;

  beforeEach((done) => {
    app = createApp();
    server = http.createServer(app);
    server.listen(0, done);
  });

  afterEach((done) => {
    if (server) {
      server.closeAllConnections?.();
      server.close(done);
    } else {
      done();
    }
  });

  describe('GET /.well-known/openid-configuration', () => {
    it('should return 200 OK with valid OpenID Provider Metadata and CORS headers', async () => {
      const response = await request(server)
        .get('/.well-known/openid-configuration')
        .set('Host', 'id.angelpixel.io');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      // OIDC Discovery must allow cross-origin retrieval from SPAs
      expect(response.headers['access-control-allow-origin']).toBe('*');

      const body = response.body;
      expect(body.issuer).toBeDefined();
      expect(body.authorization_endpoint).toBeDefined();
      expect(body.token_endpoint).toBeDefined();
      expect(body.jwks_uri).toBeDefined();
      expect(body.response_types_supported).toEqual(expect.arrayContaining(['code']));
      expect(body.subject_types_supported).toEqual(expect.arrayContaining(['public']));
      expect(body.id_token_signing_alg_values_supported).toEqual(['RS256']);
      expect(body.scopes_supported).toEqual(
        expect.arrayContaining(['openid', 'profile', 'email'])
      );
      expect(body.token_endpoint_auth_methods_supported).toEqual(
        expect.arrayContaining(['client_secret_basic', 'client_secret_post'])
      );
      expect(body.claims_supported).toEqual(
        expect.arrayContaining(['sub', 'iss', 'aud', 'exp', 'iat'])
      );
      expect(body.code_challenge_methods_supported).toEqual(['S256']);
    });
  });

  describe('GET /.well-known/jwks.json', () => {
    it('should return 200 OK with keys array and enable verifying tokens signed with the server key', async () => {
      const response = await request(server).get('/.well-known/jwks.json');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.headers['access-control-allow-origin']).toBe('*');

      const body = response.body as JwksResponseDto;
      expect(body).toHaveProperty('keys');
      expect(body.keys.length).toBeGreaterThanOrEqual(1);

      const activeKey = body.keys[0]!;
      expect(activeKey.kty).toBe('RSA');
      expect(activeKey.use).toBe('sig');
      expect(activeKey.alg).toBe('RS256');
      expect(activeKey.kid).toBeDefined();
      expect(activeKey.n).toBeDefined();
      expect(activeKey.e).toBe('AQAB');

      // Verify that the asymmetric key provider stored in app.locals can sign tokens verified with public key
      const keyProvider = app.locals.asymmetricKeyProvider as AsymmetricKeyProviderPort;
      expect(keyProvider).toBeDefined();

      const signedToken = await keyProvider.signToken({
        sub: 'user-oidc-100',
        tenantId: 'alpha-corp',
      });

      const decoded = jwt.decode(signedToken, { complete: true });
      expect(decoded?.header.alg).toBe('RS256');
      expect(decoded?.header.kid).toBe(activeKey.kid);

      const publicKeyPem = keyProvider.getPublicKeyPem();
      const verified = jwt.verify(signedToken, publicKeyPem, { algorithms: ['RS256'] }) as any;
      expect(verified.sub).toBe('user-oidc-100');
      expect(verified.tenantId).toBe('alpha-corp');
    });

    it('should respect custom injected AsymmetricKeyProviderPort in server dependencies', async () => {
      const mockKeyProvider: AsymmetricKeyProviderPort = {
        getActiveKeyId: jest.fn().mockReturnValue('custom-mock-kid-2026'),
        getPublicKeyJwks: jest.fn().mockReturnValue({
          keys: [
            {
              kty: 'RSA',
              use: 'sig',
              alg: 'RS256',
              kid: 'custom-mock-kid-2026',
              n: 'mock-modulus-base64url',
              e: 'AQAB',
            },
          ],
        }),
        getPublicKeyPem: jest.fn().mockReturnValue('-----BEGIN PUBLIC KEY-----\nMOCK\n-----END PUBLIC KEY-----'),
        signToken: jest.fn().mockResolvedValue('mock.jwt.token'),
        verifyToken: jest.fn().mockResolvedValue({ sub: 'mock-user' }),
      };

      const customApp = createApp({ asymmetricKeyProvider: mockKeyProvider });
      const customRes = await request(customApp).get('/.well-known/jwks.json');

      expect(customRes.status).toBe(200);
      expect(customRes.body.keys[0]!.kid).toBe('custom-mock-kid-2026');
      expect(mockKeyProvider.getPublicKeyJwks).toHaveBeenCalled();
    });
  });
});
