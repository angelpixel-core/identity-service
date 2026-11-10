import request from 'supertest';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Express } from 'express';
import { createApp } from '../../../interfaces/http/server';
import { InMemoryFederatedIdentityRepository } from '../../../src/contexts/identity/infrastructure/persistence/repositories/federated_identity/in_memory_federated_identity_repository';
import { InMemoryRefreshSessionRepository } from '../../../src/contexts/identity/infrastructure/persistence/repositories/refresh_session/in_memory_repository';
import { InMemorySecurityAuditLogger } from '../../../src/contexts/identity/infrastructure/logging/memory_security_audit_logger';
import { GoogleOidcAdapter } from '../../../src/contexts/identity/infrastructure/federation/google_oidc_adapter';
import { MicrosoftEntraAdapter } from '../../../src/contexts/identity/infrastructure/federation/microsoft_entra_adapter';
import { FederationStateManager } from '../../../src/contexts/identity/infrastructure/federation/federation_state_manager';
import { JsonWebKey } from '../../../src/contexts/identity/infrastructure/federation/jwks_token_verifier';
import { User } from '../../../src/contexts/identity/domain/entities/user/aggregate';
import { Email } from '../../../src/contexts/identity/domain/value_objects/email/value';
import { TenantId } from '../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { FederatedIdentity } from '../../../src/contexts/identity/domain/entities/federated_identity/aggregate';

describe('Feature: Federated Account Linking and JIT Tenant Provisioning (US-11)', () => {
  let app: Express;
  let userRepository: any;
  let federatedIdentityRepository: InMemoryFederatedIdentityRepository;
  let refreshSessionRepository: InMemoryRefreshSessionRepository;
  let auditLogger: InMemorySecurityAuditLogger;
  let federationStateManager: FederationStateManager;
  let googleAdapter: GoogleOidcAdapter;
  let microsoftAdapter: MicrosoftEntraAdapter;

  // Test RSA Keypair for signing mock IdP tokens
  let testPrivateKeyPem: string;
  let testKid = 'test-fed-linking-key-1';
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
    auditLogger = new InMemorySecurityAuditLogger();
    federationStateManager = new FederationStateManager({ secret: 'acceptance-fed-secret-32-chars-long' });
    federatedIdentityRepository = new InMemoryFederatedIdentityRepository();
    refreshSessionRepository = new InMemoryRefreshSessionRepository();

    const mockHttpClient = async (url: string, init?: any) => {
      if (url.includes('token')) {
        const bodyStr = init?.body?.toString() || '';
        const params = new URLSearchParams(bodyStr);
        const code = params.get('code') || '';
        const isMicrosoft = url.includes('microsoft');

        let email = isMicrosoft ? 'alice@acme.com' : 'john.doe@example.com';
        let sub = isMicrosoft ? 'ms-oid-2002' : 'g-sub-1001';
        let emailVerified = true;

        if (code === 'unverified-code') {
          emailVerified = false;
          email = 'unverified@acme.com';
          sub = 'g-sub-9999';
        } else if (code === 'bob-msft-code') {
          email = 'bob@acme.com';
          sub = 'ms-oid-3002';
        } else if (code === 'charlie-google-code') {
          email = 'charlie@acme.com';
          sub = 'g-sub-4001';
        }

        const idToken = jwt.sign(
          {
            iss: isMicrosoft ? 'https://login.microsoftonline.com/common/v2.0' : 'https://accounts.google.com',
            aud: isMicrosoft ? 'mock-msft-client-id' : 'mock-google-client-id',
            sub,
            oid: isMicrosoft ? sub : undefined,
            email,
            email_verified: emailVerified,
            name: 'Federated User',
            nonce: 'acceptance-nonce-1',
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
      auditLogger,
      federationStateManager,
      googleOidcAdapter: googleAdapter,
      microsoftEntraAdapter: microsoftAdapter,
      federatedIdentityRepository,
      refreshSessionRepository,
    });

    userRepository = app.locals.userRepository;
  });

  describe('Scenario: Just-In-Time (JIT) user creation for new federated identity', () => {
    it('should provision new user, create federated identity and issue native session tokens', async () => {
      // 1. Arrange: verify user does not exist in acme-corp
      const existing = await userRepository.findByEmail(Email.create('john.doe@example.com'), TenantId.create('acme-corp'));
      expect(existing).toBeNull();

      const { state } = federationStateManager.generateState({
        tenantId: 'acme-corp',
        clientId: 'portal-app',
        redirectUri: 'https://acme.local/callback',
        nonce: 'acceptance-nonce-1',
        provider: 'google',
      });

      // 2. Act: Complete federated callback
      const res = await request(app)
        .get('/api/v1/auth/federation/google/callback')
        .query({
          code: 'valid-google-code',
          state,
        });

      // 3. Assert: 200 OK with session and JIT flags
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.isNewUser).toBe(true);
      expect(res.body.linked).toBe(true);

      // Verify tokens
      expect(res.body.tokens).toBeDefined();
      expect(res.body.tokens.access_token).toBeDefined();
      expect(res.body.tokens.token_type).toBe('Bearer');
      expect(res.headers['set-cookie']).toBeDefined();
      const rawCookies = res.headers['set-cookie'];
      const cookieStr = Array.isArray(rawCookies) ? rawCookies.join('; ') : String(rawCookies);
      expect(cookieStr).toContain('refresh_token=');
      expect(cookieStr).toContain('HttpOnly');

      // Verify user provisioned in UserRepository
      const createdUser = await userRepository.findByEmail(Email.create('john.doe@example.com'), TenantId.create('acme-corp'));
      expect(createdUser).not.toBeNull();
      expect(createdUser?.getId()).toBe(res.body.user.id);

      // Verify federated identity record
      const fedIdentity = await federatedIdentityRepository.findByProviderAndSubject('google', 'g-sub-1001');
      expect(fedIdentity).not.toBeNull();
      expect(fedIdentity?.getUserId()).toBe(createdUser?.getId());
      expect(fedIdentity?.getTenantId().getValue()).toBe('acme-corp');
    });
  });

  describe('Scenario: Account linking with existing tenant user by verified email', () => {
    it('should link the external identity to the existing Alice user without duplicate User creation', async () => {
      // 1. Arrange: Existing user Alice in acme-corp
      const alice = User.create({
        id: 'alice-uuid-1',
        email: Email.create('alice@acme.com'),
        tenantId: TenantId.create('acme-corp'),
        passwordHash: '$2b$06$hashedPasswordAlice123',
      });
      await userRepository.save(alice);

      const { state } = federationStateManager.generateState({
        tenantId: 'acme-corp',
        clientId: 'portal-app',
        redirectUri: 'https://acme.local/callback',
        nonce: 'acceptance-nonce-1',
        provider: 'microsoft',
      });

      // 2. Act: Alice authenticates with Microsoft
      const res = await request(app)
        .get('/api/v1/auth/federation/microsoft/callback')
        .query({
          code: 'valid-microsoft-code',
          state,
        });

      // 3. Assert
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.isNewUser).toBe(false);
      expect(res.body.linked).toBe(true);
      expect(res.body.user.id).toBe('alice-uuid-1');
      expect(res.body.tokens.access_token).toBeDefined();

      // Verify no duplicate user was created
      const aliceCheck = await userRepository.findByEmail(Email.create('alice@acme.com'), TenantId.create('acme-corp'));
      expect(aliceCheck?.getId()).toBe('alice-uuid-1');

      // Verify federated identity record points to Alice
      const fedIdentity = await federatedIdentityRepository.findByProviderAndSubject('microsoft', 'ms-oid-2002');
      expect(fedIdentity).not.toBeNull();
      expect(fedIdentity?.getUserId()).toBe('alice-uuid-1');
    });
  });

  describe('Scenario: Multiple external providers linked to the same local user', () => {
    it('should allow linking both Google and Microsoft to the same Bob user', async () => {
      // 1. Arrange: Bob exists and already has Google linked
      const bob = User.create({
        id: 'bob-uuid-1',
        email: Email.create('bob@acme.com'),
        tenantId: TenantId.create('acme-corp'),
        passwordHash: '$2b$06$hashedPasswordBob123',
      });
      await userRepository.save(bob);

      const googleFed = FederatedIdentity.create({
        userId: 'bob-uuid-1',
        tenantId: TenantId.create('acme-corp'),
        provider: 'google',
        externalSubjectId: 'g-sub-3001',
        externalEmail: Email.create('bob@acme.com'),
      });
      await federatedIdentityRepository.save(googleFed);

      const { state } = federationStateManager.generateState({
        tenantId: 'acme-corp',
        clientId: 'portal-app',
        redirectUri: 'https://acme.local/callback',
        nonce: 'acceptance-nonce-1',
        provider: 'microsoft',
      });

      // 2. Act: Bob logs in with Microsoft Entra ID
      const res = await request(app)
        .get('/api/v1/auth/federation/microsoft/callback')
        .query({
          code: 'bob-msft-code',
          state,
        });

      // 3. Assert
      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe('bob-uuid-1');
      expect(res.body.isNewUser).toBe(false);
      expect(res.body.linked).toBe(true);

      const allIdentities = await federatedIdentityRepository.findAllByUserId('bob-uuid-1', TenantId.create('acme-corp'));
      expect(allIdentities).toHaveLength(2);
      const providers = allIdentities.map((i) => i.getProvider());
      expect(providers).toContain('google');
      expect(providers).toContain('microsoft');
    });
  });

  describe('Scenario: Existing federated identity signs in directly without relinking', () => {
    it('should authenticate Charlie using existing link and flag isNewUser=false, linked=false', async () => {
      // 1. Arrange: Charlie exists and is already linked to Google
      const charlie = User.create({
        id: 'charlie-uuid-1',
        email: Email.create('charlie@acme.com'),
        tenantId: TenantId.create('acme-corp'),
        passwordHash: '$2b$06$hashedPasswordCharlie123',
      });
      await userRepository.save(charlie);

      const charlieFed = FederatedIdentity.create({
        userId: 'charlie-uuid-1',
        tenantId: TenantId.create('acme-corp'),
        provider: 'google',
        externalSubjectId: 'g-sub-4001',
        externalEmail: Email.create('charlie@acme.com'),
      });
      await federatedIdentityRepository.save(charlieFed);

      const { state } = federationStateManager.generateState({
        tenantId: 'acme-corp',
        clientId: 'portal-app',
        redirectUri: 'https://acme.local/callback',
        nonce: 'acceptance-nonce-1',
        provider: 'google',
      });

      // 2. Act
      const res = await request(app)
        .get('/api/v1/auth/federation/google/callback')
        .query({
          code: 'charlie-google-code',
          state,
        });

      // 3. Assert
      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe('charlie-uuid-1');
      expect(res.body.isNewUser).toBe(false);
      expect(res.body.linked).toBe(false);
      expect(res.body.tokens.access_token).toBeDefined();
    });
  });

  describe('Scenario: Reject account linking when external email is not verified', () => {
    it('should reject callback with 401 and not create user or identity record', async () => {
      const { state } = federationStateManager.generateState({
        tenantId: 'acme-corp',
        clientId: 'portal-app',
        redirectUri: 'https://acme.local/callback',
        nonce: 'acceptance-nonce-1',
        provider: 'google',
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

      const user = await userRepository.findByEmail(Email.create('unverified@acme.com'), TenantId.create('acme-corp'));
      expect(user).toBeNull();

      const fedIdentity = await federatedIdentityRepository.findByProviderAndSubject('google', 'g-sub-9999');
      expect(fedIdentity).toBeNull();
    });
  });
});
