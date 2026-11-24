import http from 'http';
import request from 'supertest';
import { createApp } from '../../../interfaces/http/server';
import { JwtTokenAdapter } from '../../../src/contexts/identity/infrastructure/security/jwt_adapter';

describe('Feature: Dynamic Onboarding and Strict Phone/Method Validation (US-32)', () => {
  let server: http.Server;
  let rootToken: string;

  beforeEach(async () => {
    const tokenProvider = new JwtTokenAdapter('bdd_secret_us32_dynamic_onboarding!');
    const app = createApp({ tokenProvider });
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
      .put('/api/v1/tenants/tusherramientas-a/policy')
      .set('Authorization', `Bearer ${rootToken}`)
      .set('X-Tenant-ID', 'system')
      .send({
        requiredAttributes: { phone: true },
        kycPolicy: { required: true, minLevel: 'biometric_liveness' },
        allowedAuthMethods: { password: true, passkeys: false, federatedOidc: true },
      });

    await request(server)
      .put('/api/v1/tenants/sso-only-corp/policy')
      .set('Authorization', `Bearer ${rootToken}`)
      .set('X-Tenant-ID', 'system')
      .send({
        requiredAttributes: { phone: false },
        kycPolicy: { required: false, minLevel: 'basic' },
        allowedAuthMethods: { password: false, passkeys: false, federatedOidc: true },
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

  describe('Scenario: tusherramientas-a requires valid E.164 phone on registration', () => {
    it('rejects missing/invalid phone with 400 and accepts +5491112345678 with 201', async () => {
      const bad = await request(server)
        .post('/api/v1/auth/register')
        .set('X-Tenant-ID', 'tusherramientas-a')
        .send({ email: 'ana@tusherramientas.com', password: 'Password123!' });
      expect(bad.status).toBe(400);
      expect(bad.body.error).toBe('validation_error');

      const ok = await request(server)
        .post('/api/v1/auth/register')
        .set('X-Tenant-ID', 'tusherramientas-a')
        .send({
          email: 'ana@tusherramientas.com',
          password: 'Password123!',
          phone: '+5491112345678',
        });
      expect(ok.status).toBe(201);
      expect(ok.body.phone).toBe('+5491112345678');
    });
  });

  describe('Scenario: academia-beisbol allows registration without phone', () => {
    it('creates user with status 201', async () => {
      const ok = await request(server)
        .post('/api/v1/auth/register')
        .set('X-Tenant-ID', 'academia-beisbol')
        .send({ email: 'luis@academia-beisbol.com', password: 'Password123!' });
      expect(ok.status).toBe(201);
    });
  });

  describe('Scenario: Password method disabled returns 403 auth_method_disabled_for_tenant', () => {
    it('returns 403 auth_method_disabled_for_tenant on register and login', async () => {
      const reg = await request(server)
        .post('/api/v1/auth/register')
        .set('X-Tenant-ID', 'sso-only-corp')
        .send({ email: 'dev@sso-only-corp.com', password: 'Password123!' });
      expect(reg.status).toBe(403);
      expect(reg.body.error).toBe('auth_method_disabled_for_tenant');

      const login = await request(server)
        .post('/api/v1/auth/login')
        .set('X-Tenant-ID', 'sso-only-corp')
        .send({ email: 'dev@sso-only-corp.com', password: 'Password123!' });
      expect(login.status).toBe(403);
      expect(login.body.error).toBe('auth_method_disabled_for_tenant');
    });
  });
});
