import http from 'http';
import request from 'supertest';
import { createApp } from '../../../interfaces/http/server';
import { JwtTokenAdapter } from '../../../src/contexts/identity/infrastructure/security/jwt_adapter';
import { WebAuthnVerifierPort } from '../../../src/contexts/identity/application/ports/security/webauthn_verifier_port';

describe('Feature: WebAuthn / FIDO2 Passkey Registration (US-35)', () => {
  let server: http.Server;
  let rootToken: string;
  let userToken: string;

  const mockVerifier: WebAuthnVerifierPort = {
    generateRegistrationOptions: async (input) => ({
      challenge: 'bdd-challenge-01',
      rp: { name: input.rpName, id: input.rpID },
      user: { id: 'dXNy', name: input.userName, displayName: input.userName },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
    }),
    verifyRegistrationResponse: async () => ({
      verified: true,
      credentialId: 'cred-bdd-01',
      publicKeyCose: Buffer.from([1, 2, 3, 4]),
      counter: 0,
      transports: ['internal'],
      deviceType: 'multiDevice',
      backedUp: true,
    }),
  };

  beforeEach(async () => {
    const tokenProvider = new JwtTokenAdapter('bdd_secret_passkey_registration_32!');
    const app = createApp({ tokenProvider, webAuthnVerifier: mockVerifier });

    rootToken = await tokenProvider.generateToken({
      userId: 'usr_bdd_root',
      tenantId: 'system',
      email: 'root@angelpixel.io',
      roles: ['superadmin'],
    });

    userToken = await tokenProvider.generateToken({
      userId: '11111111-1111-4111-8111-111111111111',
      tenantId: 'acme-corp',
      email: 'alice@acme-corp.com',
      roles: ['member'],
    });

    await new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(0, resolve);
    });

    await request(server)
      .put('/api/v1/tenants/acme-corp/policy')
      .set('Authorization', `Bearer ${rootToken}`)
      .set('X-Tenant-ID', 'system')
      .send({
        allowedAuthMethods: { password: true, passkeys: true, federatedOidc: true },
      });
  });

  afterEach((done) => {
    if (server) {
      server.closeAllConnections?.();
      server.close(done);
    } else {
      done();
    }
  });

  describe('Scenario: Successful passkey registration stores COSE public key without biometric PII', () => {
    it('returns 201 and lists passkey without secrets', async () => {
      const opt = await request(server)
        .post('/api/v1/auth/passkeys/register/options')
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Tenant-ID', 'acme-corp')
        .send({ email: 'alice@acme-corp.com' });
      expect(opt.status).toBe(200);

      const ver = await request(server)
        .post('/api/v1/auth/passkeys/register/verify')
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Tenant-ID', 'acme-corp')
        .send({ response: { id: 'cred-bdd-01' } });
      expect(ver.status).toBe(201);
      expect(ver.body).not.toHaveProperty('publicKeyCose');
    });
  });

  describe('Scenario: Reusing or missing a registration challenge is rejected', () => {
    it('returns 400 invalid_webauthn_challenge on second verify', async () => {
      await request(server)
        .post('/api/v1/auth/passkeys/register/options')
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Tenant-ID', 'acme-corp')
        .send({ email: 'alice@acme-corp.com' });

      await request(server)
        .post('/api/v1/auth/passkeys/register/verify')
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Tenant-ID', 'acme-corp')
        .send({ response: { id: 'cred-bdd-01' } });

      const replay = await request(server)
        .post('/api/v1/auth/passkeys/register/verify')
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Tenant-ID', 'acme-corp')
        .send({ response: { id: 'cred-bdd-01' } });

      expect(replay.status).toBe(400);
      expect(replay.body.error).toBe('invalid_webauthn_challenge');
    });
  });

  describe('Scenario: Tenant with passkeys disabled cannot register passkeys', () => {
    it('returns 403 auth_method_disabled_for_tenant', async () => {
      const tokenProvider = new JwtTokenAdapter('bdd_secret_passkey_registration_32!');
      const legacyToken = await tokenProvider.generateToken({
        userId: 'usr_legacy',
        tenantId: 'legacy-corp',
        email: 'user@legacy-corp.com',
        roles: ['member'],
      });

      const res = await request(server)
        .post('/api/v1/auth/passkeys/register/options')
        .set('Authorization', `Bearer ${legacyToken}`)
        .set('X-Tenant-ID', 'legacy-corp')
        .send({ email: 'user@legacy-corp.com' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('auth_method_disabled_for_tenant');
    });
  });
});
