import request from 'supertest';
import { Express } from 'express';
import { createApp } from '../../../../interfaces/http/server';
import { JwtTokenAdapter } from '../../../../src/contexts/identity/infrastructure/security/jwt_adapter';

describe('Integration API: GET /api/v1/oauth2/clients (US-25 & US-03)', () => {
  let tokenProvider: JwtTokenAdapter;
  let app: Express;
  let userToken: string;

  beforeEach(async () => {
    tokenProvider = new JwtTokenAdapter('test_secret_oauth2_clients_list_32_chars!');
    app = createApp({ tokenProvider });
    userToken = await tokenProvider.generateToken({
      userId: 'usr_tenant_admin_01',
      tenantId: 'acme-corp',
      email: 'admin@acme-corp.com',
      roles: ['member'],
    });
  });

  it('should return 401 Unauthorized when Authorization token is missing', async () => {
    const res = await request(app)
      .get('/api/v1/oauth2/clients')
      .set('X-Tenant-ID', 'acme-corp');
    expect(res.status).toBe(401);
  });

  it('should return 403 Forbidden when X-Tenant-ID does not match JWT tenant', async () => {
    const res = await request(app)
      .get('/api/v1/oauth2/clients')
      .set('Authorization', `Bearer ${userToken}`)
      .set('X-Tenant-ID', 'beta-corp');
    expect(res.status).toBe(403);
  });

  it('should return 200 OK with registered clients and never expose clientSecretHash', async () => {
    const res = await request(app)
      .get('/api/v1/oauth2/clients')
      .set('Authorization', `Bearer ${userToken}`)
      .set('X-Tenant-ID', 'acme-corp');

    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(res.body.clients)).toBe(true);

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('clientSecretHash');
    expect(serialized).not.toContain('client_secret_hash');

    const portalWeb = res.body.clients.find((c: any) => c.clientId === 'portal-web');
    expect(portalWeb).toEqual(
      expect.objectContaining({
        clientId: 'portal-web',
        clientType: 'public',
        isActive: true,
        allowedOrigins: ['https://portal.angelpixel.io'],
      })
    );
  });
});
