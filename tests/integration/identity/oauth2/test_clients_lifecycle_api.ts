import request from 'supertest';
import { Express } from 'express';
import { createApp } from '../../../../interfaces/http/server';
import { JwtTokenAdapter } from '../../../../src/contexts/identity/infrastructure/security/jwt_adapter';

describe('Integration API: /api/v1/clients Lifecycle & Secret Rotation (US-28)', () => {
  let tokenProvider: JwtTokenAdapter;
  let app: Express;
  let acmeToken: string;
  let betaToken: string;

  beforeEach(async () => {
    tokenProvider = new JwtTokenAdapter('test_secret_clients_lifecycle_32_chars!');
    app = createApp({ tokenProvider });
    acmeToken = await tokenProvider.generateToken({
      userId: 'usr_acme_admin',
      tenantId: 'acme-corp',
      email: 'admin@acme-corp.com',
      roles: ['member'],
    });
    betaToken = await tokenProvider.generateToken({
      userId: 'usr_beta_admin',
      tenantId: 'beta-corp',
      email: 'admin@beta-corp.com',
      roles: ['member'],
    });
  });

  it('registers an m2m client returning clientSecret once, supports dual-grace rotation and suspension', async () => {
    // 1. Register confidential m2m client
    const createRes = await request(app)
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${acmeToken}`)
      .set('X-Tenant-ID', 'acme-corp')
      .send({
        clientId: 'billing-worker-28',
        clientName: 'Billing Worker US-28',
        clientProfile: 'm2m',
        allowedOrigins: ['https://billing.acme-corp.com'],
        scopes: ['identity:read'],
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.clientId).toBe('billing-worker-28');
    expect(createRes.body.clientType).toBe('confidential');
    expect(createRes.body.clientProfile).toBe('m2m');
    expect(createRes.body.status).toBe('active');
    expect(typeof createRes.body.clientSecret).toBe('string');
    const firstSecret = createRes.body.clientSecret as string;

    // 2. Subsequent GET /api/v1/clients never exposes hashes or secrets
    const listRes = await request(app)
      .get('/api/v1/clients')
      .set('Authorization', `Bearer ${acmeToken}`)
      .set('X-Tenant-ID', 'acme-corp');
    expect(listRes.status).toBe(200);
    expect(JSON.stringify(listRes.body)).not.toContain(firstSecret);
    expect(JSON.stringify(listRes.body)).not.toContain('clientSecretHash');
    expect(JSON.stringify(listRes.body)).not.toContain('previousSecretHash');

    // 3. Cross-tenant modification from beta-corp is blocked with 403
    const crossTenantPatch = await request(app)
      .patch('/api/v1/clients/billing-worker-28')
      .set('Authorization', `Bearer ${betaToken}`)
      .set('X-Tenant-ID', 'beta-corp')
      .send({ status: 'suspended' });
    expect(crossTenantPatch.status).toBe(403);

    // 4. Rotate secret with 300s grace window
    const rotateRes = await request(app)
      .post('/api/v1/clients/billing-worker-28/rotate-secret')
      .set('Authorization', `Bearer ${acmeToken}`)
      .set('X-Tenant-ID', 'acme-corp')
      .send({ gracePeriodSeconds: 300 });
    expect(rotateRes.status).toBe(200);
    expect(typeof rotateRes.body.clientSecret).toBe('string');
    expect(rotateRes.body.clientSecret).not.toBe(firstSecret);
    expect(rotateRes.body.secretGraceExpiresAt).toBeTruthy();
    const secondSecret = rotateRes.body.clientSecret as string;

    // 5. Both secrets authenticate during grace window
    const tokOld = await request(app)
      .post('/api/v1/oauth2/token')
      .send({
        grant_type: 'client_credentials',
        client_id: 'billing-worker-28',
        client_secret: firstSecret,
      });
    expect(tokOld.status).toBe(200);

    const tokNew = await request(app)
      .post('/api/v1/oauth2/token')
      .send({
        grant_type: 'client_credentials',
        client_id: 'billing-worker-28',
        client_secret: secondSecret,
      });
    expect(tokNew.status).toBe(200);

    // 6. Suspend blocks token issuance immediately; reactivate restores it
    const suspendRes = await request(app)
      .patch('/api/v1/clients/billing-worker-28')
      .set('Authorization', `Bearer ${acmeToken}`)
      .set('X-Tenant-ID', 'acme-corp')
      .send({ status: 'suspended' });
    expect(suspendRes.status).toBe(200);
    expect(suspendRes.body.status).toBe('suspended');

    const tokBlocked = await request(app)
      .post('/api/v1/oauth2/token')
      .send({
        grant_type: 'client_credentials',
        client_id: 'billing-worker-28',
        client_secret: secondSecret,
      });
    expect(tokBlocked.status).toBe(401);

    const reactivateRes = await request(app)
      .patch('/api/v1/clients/billing-worker-28')
      .set('Authorization', `Bearer ${acmeToken}`)
      .set('X-Tenant-ID', 'acme-corp')
      .send({ status: 'active' });
    expect(reactivateRes.status).toBe(200);
    expect(reactivateRes.body.status).toBe('active');

    const tokRestored = await request(app)
      .post('/api/v1/oauth2/token')
      .send({
        grant_type: 'client_credentials',
        client_id: 'billing-worker-28',
        client_secret: secondSecret,
      });
    expect(tokRestored.status).toBe(200);
  });

  it('rejects rotate-secret on public spa client with 400 invalid_client_operation', async () => {
    const createSpa = await request(app)
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${acmeToken}`)
      .set('X-Tenant-ID', 'acme-corp')
      .send({
        clientId: 'public-spa-28',
        clientName: 'Public SPA 28',
        clientProfile: 'spa',
        allowedOrigins: ['https://spa.acme-corp.com'],
      });
    expect(createSpa.status).toBe(201);
    expect(createSpa.body.clientSecret).toBeUndefined();

    const rotateSpa = await request(app)
      .post('/api/v1/clients/public-spa-28/rotate-secret')
      .set('Authorization', `Bearer ${acmeToken}`)
      .set('X-Tenant-ID', 'acme-corp')
      .send({ gracePeriodSeconds: 300 });
    expect(rotateSpa.status).toBe(400);
    expect(rotateSpa.body.error).toBe('invalid_client_operation');
  });
});
