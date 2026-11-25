import { createHmac } from 'crypto';
import http from 'http';
import request from 'supertest';
import { createApp } from '../../../interfaces/http/server';
import { JwtTokenAdapter } from '../../../src/contexts/identity/infrastructure/security/jwt_adapter';

describe('Feature: KYC Verification Adapter (KycVerificationPort) & RFC 9068 JWT Claims (US-37)', () => {
  const kycWebhookSecret = 'bdd_kyc_webhook_secret_32_chars!';
  let server: http.Server;
  let tokenProvider: JwtTokenAdapter;
  let userToken: string;

  beforeEach(async () => {
    tokenProvider = new JwtTokenAdapter('bdd_secret_kyc_jwt_32_chars_test!');
    const app = createApp({ tokenProvider, kycWebhookSecret });

    await new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(0, resolve);
    });

    const reg = await request(server)
      .post('/api/v1/auth/register')
      .set('X-Tenant-ID', 'tusherramientas-a')
      .send({ email: 'bdd-kyc@tusherramientas.com', password: 'Password123!' });
    userToken = reg.body.accessToken;
  });

  afterEach((done) => {
    if (server) {
      server.closeAllConnections?.();
      server.close(done);
    } else {
      done();
    }
  });

  describe('Scenario: Starting a KYC session transitions user verification to PENDING', () => {
    it('returns 201 with status PENDING and providerRef', async () => {
      const res = await request(server)
        .post('/api/v1/auth/kyc/sessions')
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Tenant-ID', 'tusherramientas-a')
        .send({ level: 'biometric_liveness' });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('PENDING');
      expect(res.body.providerRef).toBeTruthy();
    });
  });

  describe('Scenario: Signed HMAC webhook updates status to VERIFIED and projects JWT claims', () => {
    it('projects kyc_verified=true and kyc_status="VERIFIED" in JWT', async () => {
      const start = await request(server)
        .post('/api/v1/auth/kyc/sessions')
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Tenant-ID', 'tusherramientas-a')
        .send({ level: 'biometric_liveness' });

      const payload = {
        tenantId: 'tusherramientas-a',
        providerRef: start.body.providerRef,
        verdict: 'VERIFIED',
      };
      const sig = createHmac('sha256', kycWebhookSecret)
        .update(JSON.stringify(payload), 'utf8')
        .digest('hex');

      const webhookRes = await request(server)
        .post('/api/v1/auth/kyc/webhooks/result')
        .set('X-Tenant-ID', 'tusherramientas-a')
        .set('X-KYC-Signature', `sha256=${sig}`)
        .send(payload);
      expect(webhookRes.status).toBe(200);

      const loginRes = await request(server)
        .post('/api/v1/auth/login')
        .set('X-Tenant-ID', 'tusherramientas-a')
        .send({ email: 'bdd-kyc@tusherramientas.com', password: 'Password123!' });

      const decoded = await tokenProvider.verifyToken(loginRes.body.accessToken);
      expect(decoded.claims?.kyc_verified).toBe(true);
      expect(decoded.claims?.kyc_status).toBe('VERIFIED');
    });
  });

  describe('Scenario: Invalid HMAC webhook signature is rejected with 401 invalid_signature', () => {
    it('returns 401 invalid_signature', async () => {
      const res = await request(server)
        .post('/api/v1/auth/kyc/webhooks/result')
        .set('X-Tenant-ID', 'tusherramientas-a')
        .set('X-KYC-Signature', 'sha256=' + '0'.repeat(64))
        .send({
          tenantId: 'tusherramientas-a',
          providerRef: 'kyc_ref_any',
          verdict: 'VERIFIED',
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_signature');
    });
  });
});
