import { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../../../interfaces/http/server';
import { JwtTokenAdapter } from '../../../../src/contexts/identity/infrastructure/security/jwt_adapter';

describe('Integration API: US-32 Dynamic Onboarding, Phone E.164 & Password Policy Enforcement', () => {
  let app: Express;
  let rootToken: string;

  beforeEach(async () => {
    const tokenProvider = new JwtTokenAdapter('integration_secret_us32_onboarding!');
    app = createApp({ tokenProvider });

    rootToken = await tokenProvider.generateToken({
      userId: 'usr_root_01',
      tenantId: 'system',
      email: 'root@angelpixel.io',
      roles: ['superadmin'],
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

    await request(app)
      .put('/api/v1/tenants/sso-only-corp/policy')
      .set('Authorization', `Bearer ${rootToken}`)
      .set('x-tenant-id', 'system')
      .send({
        requiredAttributes: { phone: false },
        kycPolicy: { required: false, minLevel: 'basic' },
        allowedAuthMethods: { password: false, passkeys: false, federatedOidc: true },
      });
  });

  it('should enforce E.164 phone on register, persist phone and expose it on login and /auth/me', async () => {
    const missingPhone = await request(app)
      .post('/api/v1/auth/register')
      .set('x-tenant-id', 'tusherramientas-a')
      .send({
        email: 'buyer@tusherramientas.com',
        password: 'Password123!',
      });
    expect(missingPhone.status).toBe(400);
    expect(missingPhone.body.error).toBe('validation_error');

    const invalidPhone = await request(app)
      .post('/api/v1/auth/register')
      .set('x-tenant-id', 'tusherramientas-a')
      .send({
        email: 'buyer@tusherramientas.com',
        password: 'Password123!',
        phone: '11-1234-5678',
      });
    expect(invalidPhone.status).toBe(400);
    expect(invalidPhone.body.error).toBe('validation_error');

    const created = await request(app)
      .post('/api/v1/auth/register')
      .set('x-tenant-id', 'tusherramientas-a')
      .send({
        email: 'buyer@tusherramientas.com',
        password: 'Password123!',
        phone: '+54 911 1234-5678',
      });
    expect(created.status).toBe(201);
    expect(created.body.phone).toBe('+5491112345678');

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .set('x-tenant-id', 'tusherramientas-a')
      .send({
        email: 'buyer@tusherramientas.com',
        password: 'Password123!',
      });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.phone).toBe('+5491112345678');
    expect(loginRes.body.accessToken).toBeTruthy();

    const profileRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .set('x-tenant-id', 'tusherramientas-a');
    expect(profileRes.status).toBe(200);
    expect(profileRes.body.phone).toBe('+5491112345678');
  });

  it('should allow register without phone on default-policy tenant (academia-beisbol)', async () => {
    const created = await request(app)
      .post('/api/v1/auth/register')
      .set('x-tenant-id', 'academia-beisbol')
      .send({
        email: 'player@academia-beisbol.com',
        password: 'Password123!',
      });

    expect(created.status).toBe(201);
    expect(created.body.phone ?? null).toBeNull();
  });

  it('should reject register and login with 403 auth_method_disabled_for_tenant when password is disabled', async () => {
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .set('x-tenant-id', 'sso-only-corp')
      .send({
        email: 'user@sso-only-corp.com',
        password: 'Password123!',
      });
    expect(regRes.status).toBe(403);
    expect(regRes.body.error).toBe('auth_method_disabled_for_tenant');

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .set('x-tenant-id', 'sso-only-corp')
      .send({
        email: 'user@sso-only-corp.com',
        password: 'Password123!',
      });
    expect(loginRes.status).toBe(403);
    expect(loginRes.body.error).toBe('auth_method_disabled_for_tenant');
  });
});
