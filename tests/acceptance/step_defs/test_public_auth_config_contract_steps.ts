import http from 'http';
import request from 'supertest';
import { createApp } from '../../../interfaces/http/server';
import { JwtTokenAdapter } from '../../../src/contexts/identity/infrastructure/security/jwt_adapter';

describe('Feature: Public Dynamic Auth Config Contract (US-31)', () => {
  let server: http.Server;
  let rootToken: string;

  beforeEach(async () => {
    const tokenProvider = new JwtTokenAdapter('bdd_secret_public_auth_config_32!');
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
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${rootToken}`)
      .set('X-Tenant-ID', 'system')
      .send({
        tenantId: 'system',
        clientId: 'ecommerce-saas',
        clientName: 'Ecommerce SaaS',
        clientProfile: 'spa',
        allowedOrigins: ['https://tienda-a.tusherramientas.com', 'https://academia-beisbol.com'],
        redirectUris: [
          'https://tienda-a.tusherramientas.com/callback',
          'https://academia-beisbol.com/callback',
        ],
      });

    await request(server)
      .post('/api/v1/clients/ecommerce-saas/bindings')
      .set('Authorization', `Bearer ${rootToken}`)
      .set('X-Tenant-ID', 'system')
      .send({
        tenantId: 'tusherramientas-a',
        customDomain: 'tienda-a.tusherramientas.com',
        allowedRedirectUris: ['https://tienda-a.tusherramientas.com/callback'],
        allowedCorsOrigins: ['https://tienda-a.tusherramientas.com'],
      });

    await request(server)
      .post('/api/v1/clients/ecommerce-saas/bindings')
      .set('Authorization', `Bearer ${rootToken}`)
      .set('X-Tenant-ID', 'system')
      .send({
        tenantId: 'academia-beisbol',
        customDomain: 'academia-beisbol.com',
        allowedRedirectUris: ['https://academia-beisbol.com/callback'],
        allowedCorsOrigins: ['https://academia-beisbol.com'],
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
  });

  afterEach((done) => {
    if (server) {
      server.closeAllConnections?.();
      server.close(done);
    } else {
      done();
    }
  });

  describe('Scenario: Dynamic auth config for tusherramientas-a requires phone and KYC', () => {
    it('returns 200 with requiredFields including phone, kycRequired true and no secrets', async () => {
      const res = await request(server).get(
        '/api/v1/auth/config?client_id=ecommerce-saas&tenant_id=tusherramientas-a'
      );

      expect(res.status).toBe(200);
      expect(res.body.requiredFields).toEqual(['email', 'password', 'phone']);
      expect(res.body.kycRequired).toBe(true);
      expect(res.body.kycMinLevel).toBe('biometric_liveness');
      expect(res.body.federatedProviders.length).toBeGreaterThan(0);
      expect(JSON.stringify(res.body)).not.toContain('clientSecret');
    });
  });

  describe('Scenario: Dynamic auth config for academia-beisbol uses minimal required fields', () => {
    it('returns 200 with requiredFields ["email", "password"] and kycRequired false', async () => {
      const res = await request(server).get(
        '/api/v1/auth/config?client_id=ecommerce-saas&tenant_id=academia-beisbol'
      );

      expect(res.status).toBe(200);
      expect(res.body.requiredFields).toEqual(['email', 'password']);
      expect(res.body.kycRequired).toBe(false);
    });
  });

  describe('Scenario: Unbound tenant is rejected with 403 forbidden_tenant_client_binding', () => {
    it('returns 403 forbidden_tenant_client_binding', async () => {
      const res = await request(server).get(
        '/api/v1/auth/config?client_id=ecommerce-saas&tenant_id=unknown-tenant'
      );

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('forbidden_tenant_client_binding');
    });
  });
});
