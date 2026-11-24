import http from 'http';
import request from 'supertest';
import { createApp } from '../../../interfaces/http/server';
import { JwtTokenAdapter } from '../../../src/contexts/identity/infrastructure/security/jwt_adapter';
import { WebAuthnVerifierPort } from '../../../src/contexts/identity/application/ports/security/webauthn_verifier_port';

describe('Feature: WebAuthn Passkey Authentication & RFC 9068 amr Claims (US-36)', () => {
  let server: http.Server;
  let rootToken: string;
  let nextCounter = 2;

  const mockVerifier: WebAuthnVerifierPort = {
    generateRegistrationOptions: async (input) => ({
      challenge: 'bdd-reg-36',
      rp: { name: input.rpName, id: input.rpID },
      user: { id: 'dXNy', name: input.userName, displayName: input.userName },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
    }),
    verifyRegistrationResponse: async () => ({
      verified: true,
      credentialId: 'cred-bdd-36',
      publicKeyCose: Buffer.from([1, 2, 3, 4]),
      counter: 2,
      transports: ['internal'],
      deviceType: 'singleDevice',
      backedUp: false,
    }),
    generateAuthenticationOptions: async (input) => ({
      challenge: 'bdd-auth-36',
      rpId: input.rpID,
      allowCredentials: input.allowCredentialIds.map((id) => ({ id, type: 'public-key' })),
    }),
    verifyAuthenticationResponse: async () => ({
      verified: true,
      newCounter: nextCounter,
    }),
  };

  beforeEach(async () => {
    nextCounter = 3;
    const tokenProvider = new JwtTokenAdapter('bdd_secret_passkey_auth_32_chars!');
    const app = createApp({ tokenProvider, webAuthnVerifier: mockVerifier });
    rootToken = await tokenProvider.generateToken({
      userId: 'usr_bdd_root',
      tenantId: 'system',
      email: 'root@angelpixel.io',
      roles: ['superadmin'],
    });

    await new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(0, resolve);
    });

    await request(server)
      .put('/api/v1/tenants/acme-corp/policy')
      .set('Authorization', `Bearer ${rootToken}`)
      .set('X-Tenant-ID', 'system')
      .send({ allowedAuthMethods: { password: true, passkeys: true, federatedOidc: true } });

    const reg = await request(server)
      .post('/api/v1/auth/register')
      .set('X-Tenant-ID', 'acme-corp')
      .send({ email: 'bdd-passkey@acme-corp.com', password: 'Password123!' });

    await request(server)
      .post('/api/v1/auth/passkeys/register/options')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .set('X-Tenant-ID', 'acme-corp')
      .send({ email: 'bdd-passkey@acme-corp.com' });

    await request(server)
      .post('/api/v1/auth/passkeys/register/verify')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .set('X-Tenant-ID', 'acme-corp')
      .send({ response: { id: 'cred-bdd-36' } });
  });

  afterEach((done) => {
    if (server) {
      server.closeAllConnections?.();
      server.close(done);
    } else {
      done();
    }
  });

  describe('Scenario: Successful passkey authentication emits JWT with amr ["hwk", "user"]', () => {
    it('returns 200 with amr ["hwk", "user"] and HttpOnly refresh_token cookie', async () => {
      await request(server)
        .post('/api/v1/auth/passkeys/login/options')
        .set('X-Tenant-ID', 'acme-corp')
        .send({});

      const ver = await request(server)
        .post('/api/v1/auth/passkeys/login/verify')
        .set('X-Tenant-ID', 'acme-corp')
        .send({ challenge: 'bdd-auth-36', response: { id: 'cred-bdd-36' } });

      expect(ver.status).toBe(200);
      expect(ver.body.amr).toEqual(['hwk', 'user']);
      expect(String(ver.headers['set-cookie'] ?? '')).toContain('refresh_token=');
    });
  });

  describe('Scenario: Passkey signCount regression triggers clone detection', () => {
    it('returns 401 invalid_grant on counter regression', async () => {
      nextCounter = 2;
      await request(server)
        .post('/api/v1/auth/passkeys/login/options')
        .set('X-Tenant-ID', 'acme-corp')
        .send({});

      const ver = await request(server)
        .post('/api/v1/auth/passkeys/login/verify')
        .set('X-Tenant-ID', 'acme-corp')
        .send({ challenge: 'bdd-auth-36', response: { id: 'cred-bdd-36' } });

      expect(ver.status).toBe(401);
      expect(ver.body.error).toBe('invalid_grant');
    });
  });

  describe('Scenario: Tenant with passkeys disabled rejects passkey authentication', () => {
    it('returns 403 auth_method_disabled_for_tenant', async () => {
      const res = await request(server)
        .post('/api/v1/auth/passkeys/login/options')
        .set('X-Tenant-ID', 'legacy-corp')
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('auth_method_disabled_for_tenant');
    });
  });
});
