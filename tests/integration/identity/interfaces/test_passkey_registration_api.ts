import { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../../../interfaces/http/server';
import { JwtTokenAdapter } from '../../../../src/contexts/identity/infrastructure/security/jwt_adapter';
import { WebAuthnVerifierPort } from '../../../../src/contexts/identity/application/ports/security/webauthn_verifier_port';
import { PostgresWebAuthnCredentialRepository } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/webauthn/postgres_webauthn_credential_repository';
import { WebAuthnCredential } from '../../../../src/contexts/identity/domain/entities/webauthn_credential/entity';
import { TenantId } from '../../../../src/contexts/identity/domain/value_objects/tenant_id/value';

describe('Integration API: /api/v1/auth/passkeys/* (US-35)', () => {
  let app: Express;
  let rootToken: string;
  let userToken: string;

  const mockVerifier: WebAuthnVerifierPort = {
    generateRegistrationOptions: async (input) => ({
      challenge: 'integration-challenge-01',
      rp: { name: input.rpName, id: input.rpID },
      user: { id: 'dXNy', name: input.userName, displayName: input.userName },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      excludeCredentials: input.excludeCredentialIds.map((id) => ({ id, type: 'public-key' })),
    }),
    verifyRegistrationResponse: async () => ({
      verified: true,
      credentialId: 'cred-int-01',
      publicKeyCose: Buffer.from([10, 20, 30, 40]),
      counter: 0,
      transports: ['internal'],
      deviceType: 'multiDevice',
      backedUp: true,
    }),
  };

  beforeEach(async () => {
    const tokenProvider = new JwtTokenAdapter('integration_secret_passkeys_32_ch!');
    app = createApp({ tokenProvider, webAuthnVerifier: mockVerifier });

    rootToken = await tokenProvider.generateToken({
      userId: 'usr_root_01',
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
  });

  it('should reject passkey options with 403 when TenantPolicy.allowedAuthMethods.passkeys is false', async () => {
    const res = await request(app)
      .post('/api/v1/auth/passkeys/register/options')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-tenant-id', 'acme-corp')
      .send({ email: 'alice@acme-corp.com' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('auth_method_disabled_for_tenant');
  });

  it('should complete options -> verify -> list -> revoke and reject challenge replay', async () => {
    await request(app)
      .put('/api/v1/tenants/acme-corp/policy')
      .set('Authorization', `Bearer ${rootToken}`)
      .set('x-tenant-id', 'system')
      .send({
        allowedAuthMethods: { password: true, passkeys: true, federatedOidc: true },
      });

    const optRes = await request(app)
      .post('/api/v1/auth/passkeys/register/options')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-tenant-id', 'acme-corp')
      .send({ email: 'alice@acme-corp.com' });

    expect(optRes.status).toBe(200);
    expect(optRes.body.challenge).toBe('integration-challenge-01');

    const verifyRes = await request(app)
      .post('/api/v1/auth/passkeys/register/verify')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-tenant-id', 'acme-corp')
      .send({ response: { id: 'cred-int-01' } });

    expect(verifyRes.status).toBe(201);
    expect(verifyRes.body.credentialId).toBe('cred-int-01');
    expect(verifyRes.body).not.toHaveProperty('publicKeyCose');

    // Replay must fail with 400 invalid_webauthn_challenge
    const replayRes = await request(app)
      .post('/api/v1/auth/passkeys/register/verify')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-tenant-id', 'acme-corp')
      .send({ response: { id: 'cred-int-01' } });

    expect(replayRes.status).toBe(400);
    expect(replayRes.body.error).toBe('invalid_webauthn_challenge');

    const listRes = await request(app)
      .get('/api/v1/auth/passkeys')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-tenant-id', 'acme-corp');

    expect(listRes.status).toBe(200);
    expect(listRes.body.count).toBe(1);
    expect(listRes.body.passkeys[0].credentialId).toBe('cred-int-01');

    const delRes = await request(app)
      .delete(`/api/v1/auth/passkeys/${verifyRes.body.id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-tenant-id', 'acme-corp');

    expect(delRes.status).toBe(200);
    expect(delRes.body.revoked).toBe(true);
  });

  it('should execute parameterized SQL queries in PostgresWebAuthnCredentialRepository', async () => {
    const mockDb = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const repo = new PostgresWebAuthnCredentialRepository(mockDb);

    const cred = WebAuthnCredential.create({
      id: '22222222-2222-4222-8222-222222222222',
      userId: '11111111-1111-4111-8111-111111111111',
      tenantId: TenantId.create('acme-corp'),
      credentialId: 'cred-pg-1',
      publicKeyCose: Buffer.from([1, 2, 3]),
    });

    await repo.save(cred);
    expect(mockDb.query).toHaveBeenCalledTimes(1);
    expect(mockDb.query.mock.calls[0]?.[0]).toContain('INSERT INTO webauthn_credentials');
  });
});
