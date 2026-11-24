import { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../../../interfaces/http/server';
import { JwtTokenAdapter } from '../../../../src/contexts/identity/infrastructure/security/jwt_adapter';

describe('Integration API: GET /api/v1/auth/config (US-31)', () => {
  let app: Express;
  let rootToken: string;
  let academiaAdminToken: string;

  beforeEach(async () => {
    const tokenProvider = new JwtTokenAdapter('integration_secret_auth_config_32!');
    app = createApp({ tokenProvider });

    rootToken = await tokenProvider.generateToken({
      userId: 'usr_root_01',
      tenantId: 'system',
      email: 'root@angelpixel.io',
      roles: ['superadmin'],
    });

    academiaAdminToken = await tokenProvider.generateToken({
      userId: 'usr_admin_academia',
      tenantId: 'academia-beisbol',
      email: 'admin@academia-beisbol.com',
      roles: ['tenant_admin'],
    });

    await request(app)
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${rootToken}`)
      .set('x-tenant-id', 'system')
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

    await request(app)
      .post('/api/v1/clients/ecommerce-saas/bindings')
      .set('Authorization', `Bearer ${rootToken}`)
      .set('x-tenant-id', 'system')
      .send({
        tenantId: 'tusherramientas-a',
        customDomain: 'tienda-a.tusherramientas.com',
        allowedRedirectUris: ['https://tienda-a.tusherramientas.com/callback'],
        allowedCorsOrigins: ['https://tienda-a.tusherramientas.com'],
      });

    await request(app)
      .post('/api/v1/clients/ecommerce-saas/bindings')
      .set('Authorization', `Bearer ${rootToken}`)
      .set('x-tenant-id', 'system')
      .send({
        tenantId: 'academia-beisbol',
        customDomain: 'academia-beisbol.com',
        allowedRedirectUris: ['https://academia-beisbol.com/callback'],
        allowedCorsOrigins: ['https://academia-beisbol.com'],
      });

    await request(app)
      .put('/api/v1/tenants/tusherramientas-a/policy')
      .set('Authorization', `Bearer ${rootToken}`)
      .set('x-tenant-id', 'system')
      .send({
        requiredAttributes: { phone: true },
        kycPolicy: { required: true, minLevel: 'biometric_liveness' },
        allowedAuthMethods: { password: true, passkeys: false, federatedOidc: true },
      });
  });

  it('should return 200 OK with dynamic policy, ETag, Cache-Control and support 304 Not Modified', async () => {
    const res = await request(app).get(
      '/api/v1/auth/config?client_id=ecommerce-saas&tenant_id=tusherramientas-a'
    );

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, max-age=60');
    expect(res.headers['etag']).toBeTruthy();
    expect(res.body).toMatchObject({
      tenantId: 'tusherramientas-a',
      clientId: 'ecommerce-saas',
      requiredFields: ['email', 'password', 'phone'],
      kycRequired: true,
      kycMinLevel: 'biometric_liveness',
      allowedAuthMethods: { password: true, passkeys: false, federatedOidc: true },
    });
    expect(res.body.federatedProviders).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'google', protocol: 'oidc' })])
    );
    expect(JSON.stringify(res.body)).not.toContain('clientSecret');

    const notModifiedRes = await request(app)
      .get('/api/v1/auth/config?client_id=ecommerce-saas&tenant_id=tusherramientas-a')
      .set('If-None-Match', res.headers['etag'] as string);

    expect(notModifiedRes.status).toBe(304);
  });

  it('should invalidate cached auth config when TenantPolicy is updated', async () => {
    const first = await request(app).get(
      '/api/v1/auth/config?client_id=ecommerce-saas&tenant_id=academia-beisbol'
    );
    expect(first.status).toBe(200);
    expect(first.body.requiredFields).toEqual(['email', 'password']);
    expect(first.body.kycRequired).toBe(false);

    const updateRes = await request(app)
      .put('/api/v1/tenants/academia-beisbol/policy')
      .set('Authorization', `Bearer ${academiaAdminToken}`)
      .set('x-tenant-id', 'academia-beisbol')
      .send({
        requiredAttributes: { phone: true },
        kycPolicy: { required: true, minLevel: 'basic' },
      });
    expect(updateRes.status).toBe(200);

    const second = await request(app).get(
      '/api/v1/auth/config?client_id=ecommerce-saas&tenant_id=academia-beisbol'
    );
    expect(second.status).toBe(200);
    expect(second.body.requiredFields).toEqual(['email', 'password', 'phone']);
    expect(second.body.kycRequired).toBe(true);
    expect(second.headers['etag']).not.toBe(first.headers['etag']);
  });

  it('should reject unbound tenant with 403 forbidden_tenant_client_binding', async () => {
    const res = await request(app).get(
      '/api/v1/auth/config?client_id=ecommerce-saas&tenant_id=unbound-tenant'
    );

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_tenant_client_binding');
  });
});
