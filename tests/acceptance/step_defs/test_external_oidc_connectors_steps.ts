import http from 'http';
import request from 'supertest';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Express } from 'express';
import { createApp } from '../../../interfaces/http/server';
import { InMemoryClientApplicationRepository } from '../../../src/contexts/identity/infrastructure/persistence/repositories/client_application/in_memory_client_repository';
import { InMemorySecurityAuditLogger } from '../../../src/contexts/identity/infrastructure/logging/memory_security_audit_logger';
import { GoogleOidcAdapter } from '../../../src/contexts/identity/infrastructure/federation/google_oidc_adapter';
import { MicrosoftEntraAdapter } from '../../../src/contexts/identity/infrastructure/federation/microsoft_entra_adapter';
import { FederationStateManager } from '../../../src/contexts/identity/infrastructure/federation/federation_state_manager';
import { JsonWebKey } from '../../../src/contexts/identity/infrastructure/federation/jwks_token_verifier';

describe('Feature: External OIDC Provider Connectors (Google & Microsoft Entra ID - US-10)', () => {
  let app: Express;
  let server: http.Server;
  let clientRepository: InMemoryClientApplicationRepository;
  let auditLogger: InMemorySecurityAuditLogger;
  let federationStateManager: FederationStateManager;
  let googleAdapter: GoogleOidcAdapter;
  let microsoftAdapter: MicrosoftEntraAdapter;

  // Test RSA Keypair for signing mock IdP tokens
  let testPrivateKeyPem: string;
  let testKid = 'test-idp-key-1';
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

  beforeEach((done) => {
    clientRepository = new InMemoryClientApplicationRepository(true);
    auditLogger = new InMemorySecurityAuditLogger();
    federationStateManager = new FederationStateManager({ secret: 'acceptance-test-secret-32-chars-long' });

    // Mock HTTP client that intercepts token requests
    const mockHttpClient = async (url: string, init?: any) => {
      if (url.includes('token')) {
        const bodyStr = init?.body?.toString() || '';
        const params = new URLSearchParams(bodyStr);
        const code = params.get('code') || '';

        let email = 'federated.user@acme.com';
        let emailVerified: any = true;
        let sub = 'google-sub-12345';
        let nonce = 'test-nonce-123';

        if (code === 'unverified-email-code') {
          emailVerified = false;
        }

        // Try extracting original state/nonce if passed in tests
        const idToken = jwt.sign(
          {
            iss: 'https://accounts.google.com',
            aud: 'mock-google-client-id',
            sub,
            email,
            email_verified: emailVerified,
            name: 'Federated User',
            picture: 'https://cdn.local/avatar.png',
            nonce,
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
          access_token: 'mock-external-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
        };
      }

      if (url.includes('certs') || url.includes('keys')) {
        return { keys: [testJwk] };
      }

      return {};
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
      tenant: 'common',
      httpClient: mockHttpClient,
    });
    microsoftAdapter.getTokenVerifier().setKeys([testJwk]);

    app = createApp({
      clientRepository,
      auditLogger,
      federationStateManager,
      googleOidcAdapter: googleAdapter,
      microsoftEntraAdapter: microsoftAdapter,
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

  describe('Scenario: Initiate Google federated authentication with cryptographic state and nonce', () => {
    it('should generate an authorization URL pointing to Google with state and nonce', async () => {
      // When the client requests federated login via provider "google"
      const res = await request(server)
        .get('/api/v1/auth/federation/google/login')
        .query({
          tenant_id: 'acme-corp',
          client_id: 'client-web-portal',
          redirect_uri: 'https://portal.local/callback',
          format: 'json',
        });

      // Then the system should generate an authorization URL pointing to Google Accounts
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('url');
      expect(res.body).toHaveProperty('state');
      expect(res.body).toHaveProperty('nonce');

      const url = new URL(res.body.url);
      expect(url.hostname).toBe('accounts.google.com');
      expect(url.pathname).toBe('/o/oauth2/v2/auth');
      expect(url.searchParams.get('client_id')).toBe('mock-google-client-id');
      expect(url.searchParams.get('redirect_uri')).toBe('https://portal.local/callback');
      expect(url.searchParams.get('scope')).toBe('openid email profile');
      expect(url.searchParams.get('state')).toBe(res.body.state);
      expect(url.searchParams.get('nonce')).toBe(res.body.nonce);

      // Verify state can be verified and decoded
      const payload = federationStateManager.verifyState(res.body.state);
      expect(payload.tenantId).toBe('acme-corp');
      expect(payload.clientId).toBe('client-web-portal');
      expect(payload.provider).toBe('google');
      expect(payload.nonce).toBe(res.body.nonce);
    });
  });

  describe('Scenario: Initiate Microsoft Entra federated authentication', () => {
    it('should generate an authorization URL pointing to Microsoft Entra ID', async () => {
      // When the client requests federated login via provider "microsoft"
      const res = await request(server)
        .get('/api/v1/auth/federation/microsoft/login')
        .query({
          tenant_id: 'acme-corp',
          redirect_uri: 'https://portal.local/callback',
          format: 'json',
        });

      expect(res.status).toBe(200);
      const url = new URL(res.body.url);
      expect(url.hostname).toBe('login.microsoftonline.com');
      expect(url.pathname).toBe('/common/oauth2/v2.0/authorize');
      expect(url.searchParams.get('client_id')).toBe('mock-msft-client-id');
      expect(url.searchParams.get('state')).toBe(res.body.state);
    });
  });

  describe('Scenario: Successfully validate Google callback and parse verified profile', () => {
    it('should verify ID token and return normalized verified user profile', async () => {
      // Given a valid authorization code from Google and matching "state" parameter
      const { state } = federationStateManager.generateState({
        tenantId: 'acme-corp',
        clientId: 'client-web-portal',
        redirectUri: 'https://portal.local/callback',
        provider: 'google',
        nonce: 'test-nonce-123',
      });

      // When the callback endpoint processes the response
      const res = await request(server)
        .get('/api/v1/auth/federation/google/callback')
        .query({
          code: 'valid-google-code',
          state,
        });

      // Then the ID Token signature should be verified and profile returned
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.userProfile).toEqual({
        provider: 'google',
        externalSubjectId: 'google-sub-12345',
        email: 'federated.user@acme.com',
        emailVerified: true,
        name: 'Federated User',
        picture: 'https://cdn.local/avatar.png',
        rawClaims: expect.any(Object),
      });
      expect(res.body.statePayload.tenantId).toBe('acme-corp');
    });
  });

  describe('Scenario: Reject callback when cryptographic state is invalid or tampered', () => {
    it('should reject request with HTTP 400 Bad Request on tampered state', async () => {
      // Given an authorization code from Google with tampered "state" parameter
      const tamperedState = 'eyJhbGciOiJIUzI1NiJ9.invalid-signature';

      // When the callback endpoint processes the response
      const res = await request(server)
        .get('/api/v1/auth/federation/google/callback')
        .query({
          code: 'valid-google-code',
          state: tamperedState,
        });

      // Then the system should reject with 400
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_request');
      expect(res.body.error_description).toContain('state');
    });
  });

  describe('Scenario: Reject callback when external profile email is not verified', () => {
    it('should reject callback with 401 when email_verified is false', async () => {
      // Given an authorization code where the email is not verified
      const { state } = federationStateManager.generateState({
        tenantId: 'acme-corp',
        redirectUri: 'https://portal.local/callback',
        provider: 'google',
        nonce: 'test-nonce-123',
      });

      // When the callback endpoint processes the response
      const res = await request(server)
        .get('/api/v1/auth/federation/google/callback')
        .query({
          code: 'unverified-email-code',
          state,
        });

      // Then the system should reject with 401
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_grant');
      expect(res.body.error_description).toContain('not verified');
    });
  });
});
