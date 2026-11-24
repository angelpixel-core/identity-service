import { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../../../interfaces/http/server';
import { JwtTokenAdapter } from '../../../../src/contexts/identity/infrastructure/security/jwt_adapter';
import { WebAuthnVerifierPort } from '../../../../src/contexts/identity/application/ports/security/webauthn_verifier_port';

describe('Integration API: /api/v1/auth/passkeys/login/* (US-36)', () => {
  let app: Express;
  let tokenProvider: JwtTokenAdapter;
  let rootToken: string;
  let nextAuthCounter = 1;

  const mockVerifier: WebAuthnVerifierPort = {
    generateRegistrationOptions: async (input) => ({
      challenge: 'reg-chal-36',
      rp: { name: input.rpName, id: input.rpID },
      user: { id: 'dXNy', name: input.userName, displayName: input.userName },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
    }),
    verifyRegistrationResponse: async () => ({
      verified: true,
      credentialId: 'cred-int-36',
      publicKeyCose: Buffer.from([1, 2, 3, 4]),
      counter: 1,
      transports: ['internal'],
      deviceType: 'singleDevice',
      backedUp: false,
    }),
    generateAuthenticationOptions: async (input) => ({
      challenge: 'auth-chal-36',
      rpId: input.rpID,
      allowCredentials: input.allowCredentialIds.map((id) => ({ id, type: 'public-key' })),
    }),
    verifyAuthenticationResponse: async () => ({
      verified: true,
      newCounter: nextAuthCounter,
    }),
  };

  beforeEach(async () => {
    nextAuthCounter = 2;
    tokenProvider = new JwtTokenAdapter('integration_secret_passkey_auth_32!');
    app = createApp({ tokenProvider, webAuthnVerifier: mockVerifier });

    rootToken = await tokenProvider.generateToken({
      userId: 'usr_root_01',
      tenantId: 'system',
      email: 'root@angelpixel.io',
      roles: ['superadmin'],
    });

    await request(app)
      .put('/api/v1/tenants/acme-corp/policy')
      .set('Authorization', `Bearer ${rootToken}`)
      .set('x-tenant-id', 'system')
      .send({
        allowedAuthMethods: { password: true, passkeys: true, federatedOidc: true },
      });

    const regUser = await request(app)
      .post('/api/v1/auth/register')
      .set('x-tenant-id', 'acme-corp')
      .send({ email: 'passkey-user@acme-corp.com', password: 'Password123!' });

    await request(app)
      .post('/api/v1/auth/passkeys/register/options')
      .set('Authorization', `Bearer ${regUser.body.accessToken}`)
      .set('x-tenant-id', 'acme-corp')
      .send({ email: 'passkey-user@acme-corp.com' });

    await request(app)
      .post('/api/v1/auth/passkeys/register/verify')
      .set('Authorization', `Bearer ${regUser.body.accessToken}`)
      .set('x-tenant-id', 'acme-corp')
      .send({ response: { id: 'cred-int-36' } });
  });

  it('should authenticate via passkey, issue JWT with amr: ["hwk","user"] and HttpOnly refresh_token cookie', async () => {
    const optRes = await request(app)
      .post('/api/v1/auth/passkeys/login/options')
      .set('x-tenant-id', 'acme-corp')
      .send({ email: 'passkey-user@acme-corp.com' });

    expect(optRes.status).toBe(200);
    expect(optRes.body.challenge).toBe('auth-chal-36');

    const verifyRes = await request(app)
      .post('/api/v1/auth/passkeys/login/verify')
      .set('x-tenant-id', 'acme-corp')
      .send({
        challenge: 'auth-chal-36',
        response: { id: 'cred-int-36' },
      });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.amr).toEqual(['hwk', 'user']);
    const cookiesHeader = String(verifyRes.headers['set-cookie'] ?? '');
    expect(cookiesHeader).toContain('refresh_token=');
    expect(cookiesHeader).toContain('HttpOnly');

    const decoded = await tokenProvider.verifyToken(verifyRes.body.accessToken);
    expect(decoded.claims?.amr).toEqual(['hwk', 'user']);

    // Replay with consumed challenge -> 401
    const replay = await request(app)
      .post('/api/v1/auth/passkeys/login/verify')
      .set('x-tenant-id', 'acme-corp')
      .send({
        challenge: 'auth-chal-36',
        response: { id: 'cred-int-36' },
      });
    expect(replay.status).toBe(401);
    expect(replay.body.error).toBe('invalid_grant');
  });

  it('should reject signCount regression (clone detection) with 401 invalid_grant', async () => {
    // First login increments counter 1 -> 2
    await request(app)
      .post('/api/v1/auth/passkeys/login/options')
      .set('x-tenant-id', 'acme-corp')
      .send({});

    const first = await request(app)
      .post('/api/v1/auth/passkeys/login/verify')
      .set('x-tenant-id', 'acme-corp')
      .send({ challenge: 'auth-chal-36', response: { id: 'cred-int-36' } });
    expect(first.status).toBe(200);

    // Second login with regressed counter (2 <= 2) must fail
    nextAuthCounter = 2;
    await request(app)
      .post('/api/v1/auth/passkeys/login/options')
      .set('x-tenant-id', 'acme-corp')
      .send({});

    const cloneAttempt = await request(app)
      .post('/api/v1/auth/passkeys/login/verify')
      .set('x-tenant-id', 'acme-corp')
      .send({ challenge: 'auth-chal-36', response: { id: 'cred-int-36' } });

    expect(cloneAttempt.status).toBe(401);
    expect(cloneAttempt.body.error).toBe('invalid_grant');
  });

  it('should reject login options with 403 when passkeys are disabled in TenantPolicy', async () => {
    const res = await request(app)
      .post('/api/v1/auth/passkeys/login/options')
      .set('x-tenant-id', 'legacy-tenant')
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('auth_method_disabled_for_tenant');
  });
});
