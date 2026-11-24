import http from 'http';
import request from 'supertest';
import { createApp } from '../../../interfaces/http/server';
import { JwtTokenAdapter } from '../../../src/contexts/identity/infrastructure/security/jwt_adapter';

describe('Feature: Multi-Tenant / Multi-Domain Client Bindings and Explicit Tenant Resolution (US-29)', () => {
  let server: http.Server;
  let rootToken: string;

  beforeEach(async () => {
    const tokenProvider = new JwtTokenAdapter('bdd_secret_client_bindings_32_chars!');
    const app = createApp({ tokenProvider });
    rootToken = await tokenProvider.generateToken({
      userId: 'usr_bdd_root',
      tenantId: 'system',
      email: 'root@angelpixel.io',
      roles: ['superadmin', 'member'],
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
        allowedOrigins: ['https://tienda-a.tusherramientas.com', 'https://toolbox-b.com'],
        redirectUris: [
          'https://tienda-a.tusherramientas.com/callback',
          'https://toolbox-b.com/callback',
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
        tenantId: 'toolbox-b',
        customDomain: 'toolbox-b.com',
        allowedRedirectUris: ['https://toolbox-b.com/callback'],
        allowedCorsOrigins: ['https://toolbox-b.com'],
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

  describe('Scenario: Multi-domain N:M client resolves distinct tenants by explicit domain', () => {
    it('resolves tusherramientas-a and toolbox-b accurately', async () => {
      const a = await request(server).get('/api/v1/auth/config').query({
        client_id: 'ecommerce-saas',
        domain: 'tienda-a.tusherramientas.com',
      });
      const b = await request(server).get('/api/v1/auth/config').query({
        client_id: 'ecommerce-saas',
        domain: 'toolbox-b.com',
      });
      expect(a.status).toBe(200);
      expect(a.body.tenantId).toBe('tusherramientas-a');
      expect(b.status).toBe(200);
      expect(b.body.tenantId).toBe('toolbox-b');
    });
  });

  describe('Scenario: Unbound tenant is rejected with 403 forbidden_tenant_client_binding', () => {
    it('returns 403 for academia-beisbol', async () => {
      const res = await request(server).get('/api/v1/auth/config').query({
        client_id: 'ecommerce-saas',
        tenant_id: 'academia-beisbol',
      });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('forbidden_tenant_client_binding');
    });
  });

  describe('Scenario: Redirect URI belonging to another binding is rejected with 400 invalid_redirect_uri', () => {
    it('rejects toolbox-b redirect_uri when tenant_id is tusherramientas-a', async () => {
      const res = await request(server)
        .get('/oauth2/authorize')
        .set('Accept', 'application/json')
        .query({
          client_id: 'ecommerce-saas',
          tenant_id: 'tusherramientas-a',
          response_type: 'code',
          redirect_uri: 'https://toolbox-b.com/callback',
          code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
          code_challenge_method: 'S256',
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_redirect_uri');
    });
  });
});
