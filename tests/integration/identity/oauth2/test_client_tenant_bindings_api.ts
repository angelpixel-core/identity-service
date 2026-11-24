import request from 'supertest';
import { Express } from 'express';
import { createApp } from '../../../../interfaces/http/server';
import { JwtTokenAdapter } from '../../../../src/contexts/identity/infrastructure/security/jwt_adapter';

describe('Integration API: US-29 Multi-Tenant Client Bindings & /api/v1/auth/config', () => {
  let tokenProvider: JwtTokenAdapter;
  let app: Express;
  let rootToken: string;
  let tenantAToken: string;

  beforeEach(async () => {
    tokenProvider = new JwtTokenAdapter('test_secret_client_bindings_32_chars!');
    app = createApp({ tokenProvider });
    rootToken = await tokenProvider.generateToken({
      userId: 'usr_root_29',
      tenantId: 'system',
      email: 'root@angelpixel.io',
      roles: ['superadmin', 'member'],
    });
    tenantAToken = await tokenProvider.generateToken({
      userId: 'usr_a_29',
      tenantId: 'tusherramientas-a',
      email: 'admin@tusherramientas.com',
      roles: ['member'],
    });

    await request(app)
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${rootToken}`)
      .set('X-Tenant-ID', 'system')
      .send({
        tenantId: 'system',
        clientId: 'ecommerce-saas',
        clientName: 'Ecommerce SaaS Multi-Domain',
        clientProfile: 'spa',
        allowedOrigins: ['https://tienda-a.tusherramientas.com', 'https://toolbox-b.com'],
        redirectUris: [
          'https://tienda-a.tusherramientas.com/callback',
          'https://toolbox-b.com/callback',
        ],
      });
  });

  it('supports N:M bindings for multiple tenants/domains and blocks unauthorized tenant or cross-binding redirect_uri', async () => {
    const bindA = await request(app)
      .post('/api/v1/clients/ecommerce-saas/bindings')
      .set('Authorization', `Bearer ${rootToken}`)
      .set('X-Tenant-ID', 'system')
      .send({
        tenantId: 'tusherramientas-a',
        customDomain: 'tienda-a.tusherramientas.com',
        allowedRedirectUris: ['https://tienda-a.tusherramientas.com/callback'],
        allowedCorsOrigins: ['https://tienda-a.tusherramientas.com'],
      });
    expect(bindA.status).toBe(201);

    const bindB = await request(app)
      .post('/api/v1/clients/ecommerce-saas/bindings')
      .set('Authorization', `Bearer ${rootToken}`)
      .set('X-Tenant-ID', 'system')
      .send({
        tenantId: 'toolbox-b',
        customDomain: 'toolbox-b.com',
        allowedRedirectUris: ['https://toolbox-b.com/callback'],
        allowedCorsOrigins: ['https://toolbox-b.com'],
      });
    expect(bindB.status).toBe(201);

    // 1. Resolve by domain
    const cfgA = await request(app)
      .get('/api/v1/auth/config')
      .query({
        client_id: 'ecommerce-saas',
        domain: 'tienda-a.tusherramientas.com',
        redirect_uri: 'https://tienda-a.tusherramientas.com/callback',
      });
    expect(cfgA.status).toBe(200);
    expect(cfgA.body.tenantId).toBe('tusherramientas-a');

    const cfgB = await request(app)
      .get('/api/v1/auth/config')
      .query({
        client_id: 'ecommerce-saas',
        domain: 'toolbox-b.com',
        redirect_uri: 'https://toolbox-b.com/callback',
      });
    expect(cfgB.status).toBe(200);
    expect(cfgB.body.tenantId).toBe('toolbox-b');

    // 2. Unauthorized tenant rejected with 403 forbidden_tenant_client_binding
    const cfgDenied = await request(app)
      .get('/api/v1/auth/config')
      .query({
        client_id: 'ecommerce-saas',
        tenant_id: 'academia-beisbol',
      });
    expect(cfgDenied.status).toBe(403);
    expect(cfgDenied.body.error).toBe('forbidden_tenant_client_binding');

    // 3. Cross-binding redirect_uri rejected with 400 invalid_redirect_uri
    const cfgBadRedirect = await request(app)
      .get('/api/v1/auth/config')
      .query({
        client_id: 'ecommerce-saas',
        tenant_id: 'tusherramientas-a',
        redirect_uri: 'https://toolbox-b.com/callback',
      });
    expect(cfgBadRedirect.status).toBe(400);
    expect(cfgBadRedirect.body.error).toBe('invalid_redirect_uri');

    // 4. Tenant-scoped listing sees only own binding
    const listTenantA = await request(app)
      .get('/api/v1/clients/ecommerce-saas/bindings')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .set('X-Tenant-ID', 'tusherramientas-a');
    expect(listTenantA.status).toBe(200);
    expect(listTenantA.body.count).toBe(1);
    expect(listTenantA.body.bindings[0].tenantId).toBe('tusherramientas-a');
  });
});
