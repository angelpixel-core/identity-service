import { createHmac } from 'crypto';
import { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../../../interfaces/http/server';
import { JwtTokenAdapter } from '../../../../src/contexts/identity/infrastructure/security/jwt_adapter';
import { PostgresUserKycVerificationRepository } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/kyc/postgres_user_kyc_verification_repository';
import { UserKycVerification } from '../../../../src/contexts/identity/domain/entities/kyc_verification/entity';
import { TenantId } from '../../../../src/contexts/identity/domain/value_objects/tenant_id/value';

describe('Integration API: /api/v1/auth/kyc/* & JWT Claims (US-37)', () => {
  const kycWebhookSecret = 'integration_kyc_hmac_secret_32_ch!';
  let app: Express;
  let tokenProvider: JwtTokenAdapter;
  let userToken: string;

  beforeEach(async () => {
    tokenProvider = new JwtTokenAdapter('integration_secret_kyc_jwt_32_ch!');
    app = createApp({ tokenProvider, kycWebhookSecret });

    const reg = await request(app)
      .post('/api/v1/auth/register')
      .set('x-tenant-id', 'tusherramientas-a')
      .send({
        email: 'kyc-user@tusherramientas.com',
        password: 'Password123!',
      });
    userToken = reg.body.accessToken;
  });

  it('should start KYC session, reject invalid HMAC webhook (401), accept signed HMAC webhook and emit kyc_verified=true in JWT', async () => {
    const startRes = await request(app)
      .post('/api/v1/auth/kyc/sessions')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-tenant-id', 'tusherramientas-a')
      .send({ level: 'biometric_liveness' });

    expect(startRes.status).toBe(201);
    expect(startRes.body.status).toBe('PENDING');
    expect(startRes.body.providerRef).toBeTruthy();

    const statusPending = await request(app)
      .get('/api/v1/auth/kyc/status')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-tenant-id', 'tusherramientas-a');
    expect(statusPending.status).toBe(200);
    expect(statusPending.body.status).toBe('PENDING');

    const webhookPayload = {
      tenantId: 'tusherramientas-a',
      providerRef: startRes.body.providerRef,
      verdict: 'VERIFIED',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };

    const invalidSigRes = await request(app)
      .post('/api/v1/auth/kyc/webhooks/result')
      .set('x-tenant-id', 'tusherramientas-a')
      .set('x-kyc-signature', 'sha256=' + 'f'.repeat(64))
      .send(webhookPayload);

    expect(invalidSigRes.status).toBe(401);
    expect(invalidSigRes.body.error).toBe('invalid_signature');

    const sig = createHmac('sha256', kycWebhookSecret)
      .update(JSON.stringify(webhookPayload), 'utf8')
      .digest('hex');

    const validWebhookRes = await request(app)
      .post('/api/v1/auth/kyc/webhooks/result')
      .set('x-tenant-id', 'tusherramientas-a')
      .set('x-kyc-signature', `sha256=${sig}`)
      .send(webhookPayload);

    expect(validWebhookRes.status).toBe(200);
    expect(validWebhookRes.body.status).toBe('VERIFIED');
    expect(validWebhookRes.body.kycVerified).toBe(true);

    // Re-login issues JWT with kyc_verified: true & kyc_status: 'VERIFIED'
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .set('x-tenant-id', 'tusherramientas-a')
      .send({
        email: 'kyc-user@tusherramientas.com',
        password: 'Password123!',
      });

    expect(loginRes.status).toBe(200);
    const decoded = await tokenProvider.verifyToken(loginRes.body.accessToken);
    expect(decoded.claims?.kyc_verified).toBe(true);
    expect(decoded.claims?.kyc_status).toBe('VERIFIED');
  });

  it('should execute parameterized SQL queries in PostgresUserKycVerificationRepository', async () => {
    const mockDb = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const repo = new PostgresUserKycVerificationRepository(mockDb);

    const kyc = UserKycVerification.create({
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      tenantId: TenantId.create('tusherramientas-a'),
      status: 'PENDING',
      level: 'biometric_liveness',
      providerRef: 'kyc_ref_pg_01',
    });

    await repo.save(kyc);
    expect(mockDb.query).toHaveBeenCalledTimes(1);
    expect(mockDb.query.mock.calls[0]?.[0]).toContain('INSERT INTO user_kyc_verifications');
  });
});
