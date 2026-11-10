import request from 'supertest';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Express } from 'express';
import { createApp } from '../../../../interfaces/http/server';
import { GoogleOidcAdapter } from '../../../../src/contexts/identity/infrastructure/federation/google_oidc_adapter';
import { MicrosoftEntraAdapter } from '../../../../src/contexts/identity/infrastructure/federation/microsoft_entra_adapter';
import { FederationStateManager } from '../../../../src/contexts/identity/infrastructure/federation/federation_state_manager';
import { JsonWebKey } from '../../../../src/contexts/identity/infrastructure/federation/jwks_token_verifier';

describe('Integration API: /api/v1/auth/federation Endpoints (US-10)', () => {
  let app: Express;
  let federationStateManager: FederationStateManager;
  let googleAdapter: GoogleOidcAdapter;
  let microsoftAdapter: MicrosoftEntraAdapter;

  let testPrivateKeyPem: string;
  let testKid = 'fed-api-key-1';
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

  beforeEach(() => {
    federationStateManager = new FederationStateManager({ secret: 'fed-api-test-secret-32-chars-long' });

    const mockHttpClient = async (url: string, init?: any) => {
      if (url.includes('token')) {
        const bodyStr = init?.body?.toString() || '';
        const params = new URLSearchParams(bodyStr);
        const code = params.get('code') || '';

        const isMicrosoft = url.includes('microsoft');
        const idToken = jwt.sign(
          {
            iss: isMicrosoft ? 'https://login.microsoftonline.com/common/v2.0' : 'https://accounts.google.com',
            aud: isMicrosoft ? 'mock-msft-client-id' : 'mock-google-client-id',
            sub: isMicrosoft ? 'msft-sub-1' : 'google-sub-1',
            oid: isMicrosoft ? 'msft-oid-1' : undefined,
            email: isMicrosoft ? 'msft.user@corp.com' : 'google.user@acme.com',
            email_verified: code !== 'unverified-code',
            name: isMicrosoft ? 'Microsoft User' : 'Google User',
            nonce: 'test-nonce-1',
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
          access_token: 'mock-access-token',
        };
      }
      return { keys: [testJwk] };
    };

    googleAdapter = new GoogleOidcAdapter({
      clientId: 'mock-google-client-id',
      clientSecret: 'mock-google-client-secret',
      httpClient: mockHttpClient,
    });
    googleAdapter.getTokenVerifier().setKeys([testJwk]);

    microsoftAdapter = new MicrosoftEntraAdapter({
      clientId: 'mock-msft-client-id',
      clientSecret: 'mock-msft-client-secret',
      httpClient: mockHttpClient,
    });
    microsoftAdapter.getTokenVerifier().setKeys([testJwk]);

    app = createApp({
      federationStateManager,
      googleOidcAdapter: googleAdapter,
      microsoftEntraAdapter: microsoftAdapter,
    });
  });

  describe('GET /api/v1/auth/federation/:provider/login', () => {
    it('should redirect 302 to Google authorization URL by default', async () => {
      const res = await request(app)
        .get('/api/v1/auth/federation/google/login')
        .query({
          tenant_id: 'acme-tenant',
          redirect_uri: 'https://acme.local/auth/callback',
        });

      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(res.headers.location).toContain('client_id=mock-google-client-id');
      expect(res.headers.location).toContain('state=');
      expect(res.headers.location).toContain('nonce=');
    });

    it('should return JSON when format=json query parameter is present', async () => {
      const res = await request(app)
        .get('/api/v1/auth/federation/microsoft/login')
        .query({
          tenant_id: 'acme-tenant',
          redirect_uri: 'https://acme.local/auth/callback',
          format: 'json',
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('url');
      expect(res.body).toHaveProperty('state');
      expect(res.body).toHaveProperty('nonce');
      expect(res.body.url).toContain('https://login.microsoftonline.com');
    });

    it('should reject with 400 when provider is not supported', async () => {
      const res = await request(app)
        .get('/api/v1/auth/federation/github/login')
        .query({
          tenant_id: 'acme-tenant',
          redirect_uri: 'https://acme.local/auth/callback',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_request');
      expect(res.body.error_description).toContain('Unsupported identity provider');
    });

    it('should reject with 400 when tenant_id is missing', async () => {
      const res = await request(app)
        .get('/api/v1/auth/federation/google/login')
        .query({
          redirect_uri: 'https://acme.local/auth/callback',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_request');
      expect(res.body.error_description).toContain('tenant_id is required');
    });
  });

  describe('GET & POST /api/v1/auth/federation/:provider/callback', () => {
    it('should successfully process valid callback and return normalized user profile', async () => {
      const { state } = federationStateManager.generateState({
        tenantId: 'acme-tenant',
        clientId: 'web-app',
        redirectUri: 'https://acme.local/auth/callback',
        provider: 'google',
        nonce: 'test-nonce-1',
      });

      const res = await request(app)
        .get('/api/v1/auth/federation/google/callback')
        .query({
          code: 'valid-google-auth-code',
          state,
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.userProfile.email).toBe('google.user@acme.com');
      expect(res.body.userProfile.provider).toBe('google');
      expect(res.body.statePayload.tenantId).toBe('acme-tenant');
      expect(res.body.statePayload.clientId).toBe('web-app');
    });

    it('should support POST method for callback (e.g. form_post response mode)', async () => {
      const { state } = federationStateManager.generateState({
        tenantId: 'acme-tenant',
        redirectUri: 'https://acme.local/auth/callback',
        provider: 'microsoft',
        nonce: 'test-nonce-1',
      });

      const res = await request(app)
        .post('/api/v1/auth/federation/microsoft/callback')
        .send({
          code: 'valid-msft-auth-code',
          state,
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.userProfile.email).toBe('msft.user@corp.com');
      expect(res.body.userProfile.provider).toBe('microsoft');
    });

    it('should reject with 400 when state signature is invalid', async () => {
      const res = await request(app)
        .get('/api/v1/auth/federation/google/callback')
        .query({
          code: 'valid-code',
          state: 'tampered.state.token',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_request');
    });

    it('should reject with 401 when email is not verified', async () => {
      const { state } = federationStateManager.generateState({
        tenantId: 'acme-tenant',
        redirectUri: 'https://acme.local/auth/callback',
        provider: 'google',
        nonce: 'test-nonce-1',
      });

      const res = await request(app)
        .get('/api/v1/auth/federation/google/callback')
        .query({
          code: 'unverified-code',
          state,
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_grant');
      expect(res.body.error_description).toContain('not verified');
    });
  });
});

