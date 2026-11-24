import http from 'http';
import request from 'supertest';
import { createApp } from '../../../interfaces/http/server';
import { JwtTokenAdapter } from '../../../src/contexts/identity/infrastructure/security/jwt_adapter';

describe('Feature: Client Lifecycle Management and Dual-Grace Secret Rotation (US-28)', () => {
  let server: http.Server;
  let token: string;

  beforeEach(async () => {
    const tokenProvider = new JwtTokenAdapter('bdd_secret_client_lifecycle_32_chars!');
    const app = createApp({ tokenProvider });
    token = await tokenProvider.generateToken({
      userId: 'usr_bdd_admin',
      tenantId: 'acme-corp',
      email: 'admin@acme-corp.com',
      roles: ['member'],
    });
    await new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(0, resolve);
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

  describe('Scenario: Confidential M2M registration returns secret once and never exposes hashes', () => {
    it('should return 201 with one-time clientSecret and hide hashes in GET /api/v1/clients', async () => {
      const createRes = await request(server)
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', 'acme-corp')
        .send({
          clientId: 'bdd-m2m-worker',
          clientName: 'BDD M2M Worker',
          clientProfile: 'm2m',
          allowedOrigins: ['https://bdd.acme-corp.com'],
        });

      expect(createRes.status).toBe(201);
      expect(typeof createRes.body.clientSecret).toBe('string');

      const listRes = await request(server)
        .get('/api/v1/clients')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', 'acme-corp');
      expect(listRes.status).toBe(200);
      expect(JSON.stringify(listRes.body)).not.toContain('clientSecretHash');
    });
  });

  describe('Scenario: Dual-grace secret rotation allows both old and new secrets without downtime', () => {
    it('should accept both previous and new secrets within grace period', async () => {
      const createRes = await request(server)
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', 'acme-corp')
        .send({
          clientId: 'bdd-grace-worker',
          clientName: 'BDD Grace Worker',
          clientProfile: 'm2m',
          allowedOrigins: ['https://grace.acme-corp.com'],
        });

      const oldSecret = createRes.body.clientSecret;

      const rotateRes = await request(server)
        .post('/api/v1/clients/bdd-grace-worker/rotate-secret')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', 'acme-corp')
        .send({ gracePeriodSeconds: 300 });

      expect(rotateRes.status).toBe(200);
      const newSecret = rotateRes.body.clientSecret;

      const resOld = await request(server).post('/api/v1/oauth2/token').send({
        grant_type: 'client_credentials',
        client_id: 'bdd-grace-worker',
        client_secret: oldSecret,
      });
      const resNew = await request(server).post('/api/v1/oauth2/token').send({
        grant_type: 'client_credentials',
        client_id: 'bdd-grace-worker',
        client_secret: newSecret,
      });

      expect(resOld.status).toBe(200);
      expect(resNew.status).toBe(200);
    });
  });

  describe('Scenario: Suspending a client blocks OAuth2 token issuance immediately', () => {
    it('should reject M2M token issuance with HTTP 401 when suspended', async () => {
      const createRes = await request(server)
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', 'acme-corp')
        .send({
          clientId: 'bdd-suspend-worker',
          clientName: 'BDD Suspend Worker',
          clientProfile: 'm2m',
          allowedOrigins: ['https://suspend.acme-corp.com'],
        });

      const secret = createRes.body.clientSecret;

      const patchRes = await request(server)
        .patch('/api/v1/clients/bdd-suspend-worker')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', 'acme-corp')
        .send({ status: 'suspended' });
      expect(patchRes.status).toBe(200);

      const tokenRes = await request(server).post('/api/v1/oauth2/token').send({
        grant_type: 'client_credentials',
        client_id: 'bdd-suspend-worker',
        client_secret: secret,
      });
      expect(tokenRes.status).toBe(401);
    });
  });
});
