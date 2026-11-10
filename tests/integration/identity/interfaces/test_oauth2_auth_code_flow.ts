import http from 'http';
import request from 'supertest';
import { Express } from 'express';
import { createApp } from '../../../../interfaces/http/server';
import { InMemoryClientApplicationRepository } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/client_application/in_memory_client_repository';
import { InMemoryAuthorizationCodeRepository } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/authorization_code/in_memory_repository';
import { RsaKeyAdapter } from '../../../../src/contexts/identity/infrastructure/security/rsa_key_adapter';
import { ClientApplication } from '../../../../src/contexts/identity/domain/entities/client_application/aggregate';
import { ClientId } from '../../../../src/contexts/identity/domain/value_objects/client_id/value';
import { OriginDomain } from '../../../../src/contexts/identity/domain/value_objects/origin_domain/value';
import { BcryptAdapter } from '../../../../src/contexts/identity/infrastructure/security/bcrypt_adapter';

describe('Integration API: OAuth2 Authorization Code Flow with PKCE (RFC 6749 & RFC 7636)', () => {
  let app: Express;
  let server: http.Server;
  let clientRepository: InMemoryClientApplicationRepository;
  let authCodeRepository: InMemoryAuthorizationCodeRepository;
  let asymmetricKeyProvider: RsaKeyAdapter;
  const hashProvider = new BcryptAdapter(4);

  // RFC 7636 Test Vectors
  const validVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const expectedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

  beforeAll(async () => {
    clientRepository = new InMemoryClientApplicationRepository(true);
    authCodeRepository = new InMemoryAuthorizationCodeRepository();
    asymmetricKeyProvider = new RsaKeyAdapter();

    const confidentialSecretHash = await hashProvider.hash('ConfidentialSecret123!_SuperSecure');
    const confidentialClient = ClientApplication.create({
      id: 'client-portal-admin-uuid',
      clientId: ClientId.create('portal-admin'),
      clientSecretHash: confidentialSecretHash,
      clientName: 'Portal Admin WebApp',
      clientType: 'confidential',
      allowedOrigins: [OriginDomain.create('https://admin.portal.local')],
      redirectUris: ['https://admin.portal.local/oauth/callback'],
      allowedGrantTypes: ['authorization_code'],
      scopes: ['openid', 'admin'],
      isActive: true,
    });
    await clientRepository.save(confidentialClient);

    const m2mSecretHash = await hashProvider.hash('M2mSecret123!_SuperSecureSecretForTesting');
    const m2mClient = ClientApplication.create({
      id: 'client-m2m-worker-uuid',
      clientId: ClientId.create('m2m-worker'),
      clientSecretHash: m2mSecretHash,
      clientName: 'M2M Background Worker',
      clientType: 'confidential',
      allowedOrigins: [OriginDomain.create('https://m2m.worker.local')],
      redirectUris: [],
      allowedGrantTypes: ['client_credentials'],
      scopes: ['internal:read'],
      isActive: true,
    });
    await clientRepository.save(m2mClient);
  });

  beforeEach((done) => {
    authCodeRepository = new InMemoryAuthorizationCodeRepository();
    app = createApp({
      clientRepository,
      authCodeRepository,
      asymmetricKeyProvider,
      hashProvider,
    });
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

  describe('GET /oauth2/authorize & POST /oauth2/authorize (Protocol Endpoints)', () => {
    it('should return 302 redirect with code and state on valid public client authorization request', async () => {
      const response = await request(server)
        .get('/oauth2/authorize')
        .query({
          response_type: 'code',
          client_id: 'e-commerce-spa',
          redirect_uri: 'https://shop.local/callback',
          scope: 'openid profile',
          code_challenge: expectedChallenge,
          code_challenge_method: 'S256',
          state: 'state-session-1234',
        });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBeDefined();

      const target = new URL(response.headers.location as string);
      expect(target.origin).toBe('https://shop.local');
      expect(target.pathname).toBe('/callback');
      expect(target.searchParams.get('state')).toBe('state-session-1234');
      expect(target.searchParams.get('code')).toBeTruthy();
    });

    it('should return JSON payload when requested via Accept: application/json', async () => {
      const response = await request(server)
        .post('/oauth2/authorize')
        .set('Accept', 'application/json')
        .send({
          response_type: 'code',
          client_id: 'e-commerce-spa',
          redirect_uri: 'https://shop.local/callback',
          scope: 'openid',
          code_challenge: expectedChallenge,
          code_challenge_method: 'S256',
          state: 'xyz-99',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('code');
      expect(response.body).toHaveProperty('redirect_uri', 'https://shop.local/callback');
      expect(response.body).toHaveProperty('state', 'xyz-99');
      expect(response.body).toHaveProperty('callback_url');
    });

    it('should reject when response_type is not code with error unsupported_response_type', async () => {
      const response = await request(server)
        .get('/oauth2/authorize')
        .query({
          response_type: 'token',
          client_id: 'e-commerce-spa',
          redirect_uri: 'https://shop.local/callback',
          code_challenge: expectedChallenge,
          code_challenge_method: 'S256',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'unsupported_response_type');
    });

    it('should reject when redirect_uri is not pre-registered for the client with error invalid_request', async () => {
      const response = await request(server)
        .get('/oauth2/authorize')
        .query({
          response_type: 'code',
          client_id: 'e-commerce-spa',
          redirect_uri: 'https://attacker.site/callback',
          code_challenge: expectedChallenge,
          code_challenge_method: 'S256',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'invalid_request');
    });

    it('should reject when client_id does not exist with error invalid_client', async () => {
      const response = await request(server)
        .get('/oauth2/authorize')
        .query({
          response_type: 'code',
          client_id: 'non-existent-client',
          redirect_uri: 'https://shop.local/callback',
          code_challenge: expectedChallenge,
          code_challenge_method: 'S256',
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'invalid_client');
    });
  });

  describe('POST /oauth2/token (authorization_code grant)', () => {
    it('should exchange code for public client and return RS256 signed access_token & id_token', async () => {
      const authRes = await request(server)
        .get('/oauth2/authorize')
        .query({
          response_type: 'code',
          client_id: 'e-commerce-spa',
          redirect_uri: 'https://shop.local/callback',
          scope: 'openid profile',
          code_challenge: expectedChallenge,
          code_challenge_method: 'S256',
        });

      const target = new URL(authRes.headers.location as string);
      const code = target.searchParams.get('code')!;

      const tokenRes = await request(server)
        .post('/oauth2/token')
        .send({
          grant_type: 'authorization_code',
          client_id: 'e-commerce-spa',
          code,
          redirect_uri: 'https://shop.local/callback',
          code_verifier: validVerifier,
        });

      expect(tokenRes.status).toBe(200);
      expect(tokenRes.body).toHaveProperty('access_token');
      expect(tokenRes.body).toHaveProperty('token_type', 'Bearer');
      expect(tokenRes.body).toHaveProperty('expires_in', 900);
      expect(tokenRes.body).toHaveProperty('id_token');
      expect(tokenRes.body).toHaveProperty('scope', 'openid profile');

      // Verify JWT RS256 decoding
      const idTokenClaims = await asymmetricKeyProvider.verifyToken(tokenRes.body.id_token);
      expect(idTokenClaims.aud).toBe('e-commerce-spa');
      expect(idTokenClaims.sub).toBeTruthy();
    });

    it('should exchange code for confidential client with Basic Auth credentials', async () => {
      const authRes = await request(server)
        .get('/oauth2/authorize')
        .query({
          response_type: 'code',
          client_id: 'portal-admin',
          redirect_uri: 'https://admin.portal.local/oauth/callback',
          scope: 'openid admin',
          code_challenge: expectedChallenge,
          code_challenge_method: 'S256',
        });

      const target = new URL(authRes.headers.location as string);
      const code = target.searchParams.get('code')!;

      const credentials = Buffer.from('portal-admin:ConfidentialSecret123!_SuperSecure').toString('base64');
      const tokenRes = await request(server)
        .post('/oauth2/token')
        .set('Authorization', `Basic ${credentials}`)
        .send({
          grant_type: 'authorization_code',
          code,
          redirect_uri: 'https://admin.portal.local/oauth/callback',
          code_verifier: validVerifier,
        });

      expect(tokenRes.status).toBe(200);
      expect(tokenRes.body.access_token).toBeDefined();
      expect(tokenRes.body.id_token).toBeDefined();
    });

    it('should reject token exchange when redirect_uri does not match authorization step', async () => {
      const authRes = await request(server)
        .get('/oauth2/authorize')
        .query({
          response_type: 'code',
          client_id: 'e-commerce-spa',
          redirect_uri: 'https://shop.local/callback',
          code_challenge: expectedChallenge,
          code_challenge_method: 'S256',
        });

      const target = new URL(authRes.headers.location as string);
      const code = target.searchParams.get('code')!;

      const tokenRes = await request(server)
        .post('/oauth2/token')
        .send({
          grant_type: 'authorization_code',
          client_id: 'e-commerce-spa',
          code,
          redirect_uri: 'https://shop.local/other-callback',
          code_verifier: validVerifier,
        });

      expect(tokenRes.status).toBe(400);
      expect(tokenRes.body).toHaveProperty('error', 'invalid_grant');
    });

    it('should reject token exchange when code is non-existent', async () => {
      const tokenRes = await request(server)
        .post('/oauth2/token')
        .send({
          grant_type: 'authorization_code',
          client_id: 'e-commerce-spa',
          code: 'non_existent_code_12345',
          redirect_uri: 'https://shop.local/callback',
          code_verifier: validVerifier,
        });

      expect(tokenRes.status).toBe(400);
      expect(tokenRes.body).toHaveProperty('error', 'invalid_grant');
    });

    it('should reject token exchange when client is not authorized for authorization_code grant', async () => {
      const tokenRes = await request(server)
        .post('/oauth2/token')
        .send({
          grant_type: 'authorization_code',
          client_id: 'm2m-worker',
          client_secret: 'M2mSecret123!_SuperSecureSecretForTesting',
          code: 'any_code',
          redirect_uri: 'https://shop.local/callback',
          code_verifier: validVerifier,
        });

      expect(tokenRes.status).toBe(400);
      expect(tokenRes.body).toHaveProperty('error', 'unauthorized_client');
    });
  });
});