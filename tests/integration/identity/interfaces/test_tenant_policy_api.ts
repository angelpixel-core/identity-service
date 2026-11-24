import { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../../../interfaces/http/server';
import { JwtTokenAdapter } from '../../../../src/contexts/identity/infrastructure/security/jwt_adapter';
import {
  SecurityAuditLoggerPort,
  SecurityAuditEvent,
} from '../../../../src/contexts/identity/application/ports/security/audit_logger';

describe('Integration API: /api/v1/tenants/:tenantId/policy (US-30)', () => {
  let app: Express;
  let tokenProvider: JwtTokenAdapter;
  let memberToken: string;
  let tenantAdminToken: string;
  let globexAdminToken: string;
  let superadminToken: string;
  let loggedEvents: SecurityAuditEvent[];

  beforeEach(async () => {
    tokenProvider = new JwtTokenAdapter('integration_secret_tenant_policy_32!');
    loggedEvents = [];
    const auditLogger: SecurityAuditLoggerPort = {
      logEvent: async (event: SecurityAuditEvent) => {
        loggedEvents.push(event);
      },
    };
    app = createApp({ tokenProvider, auditLogger });

    memberToken = await tokenProvider.generateToken({
      userId: 'usr_member_acme',
      tenantId: 'acme-corp',
      email: 'member@acme-corp.com',
      roles: ['member'],
    });

    tenantAdminToken = await tokenProvider.generateToken({
      userId: 'usr_admin_acme',
      tenantId: 'acme-corp',
      email: 'admin@acme-corp.com',
      roles: ['tenant_admin'],
    });

    globexAdminToken = await tokenProvider.generateToken({
      userId: 'usr_admin_globex',
      tenantId: 'globex',
      email: 'admin@globex.com',
      roles: ['tenant_admin'],
    });

    superadminToken = await tokenProvider.generateToken({
      userId: 'usr_root_01',
      tenantId: 'system',
      email: 'root@angelpixel.io',
      roles: ['superadmin'],
    });
  });

  it('should reject unauthenticated requests with 401', async () => {
    const res = await request(app)
      .get('/api/v1/tenants/acme-corp/policy')
      .set('x-tenant-id', 'acme-corp');

    expect(res.status).toBe(401);
  });

  it('should return safe default policy for authenticated tenant member (200 OK)', async () => {
    const res = await request(app)
      .get('/api/v1/tenants/acme-corp/policy')
      .set('Authorization', `Bearer ${memberToken}`)
      .set('x-tenant-id', 'acme-corp');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      tenantId: 'acme-corp',
      isDefault: true,
      requiredAttributes: { phone: false },
      kycPolicy: { required: false, minLevel: 'basic' },
      allowedAuthMethods: { password: true, passkeys: false, federatedOidc: true },
    });
  });

  it('should reject PUT from member role with 403 Forbidden', async () => {
    const res = await request(app)
      .put('/api/v1/tenants/acme-corp/policy')
      .set('Authorization', `Bearer ${memberToken}`)
      .set('x-tenant-id', 'acme-corp')
      .send({
        requiredAttributes: { phone: true },
      });

    expect(res.status).toBe(403);
  });

  it('should reject cross-tenant GET and PUT with 403 Forbidden', async () => {
    const getRes = await request(app)
      .get('/api/v1/tenants/acme-corp/policy')
      .set('Authorization', `Bearer ${globexAdminToken}`)
      .set('x-tenant-id', 'globex');
    expect(getRes.status).toBe(403);

    const putRes = await request(app)
      .put('/api/v1/tenants/acme-corp/policy')
      .set('Authorization', `Bearer ${globexAdminToken}`)
      .set('x-tenant-id', 'globex')
      .send({ requiredAttributes: { phone: true } });
    expect(putRes.status).toBe(403);
  });

  it('should allow tenant_admin to update policy, persist it, and emit TENANT_POLICY_UPDATED audit event', async () => {
    const putRes = await request(app)
      .put('/api/v1/tenants/acme-corp/policy')
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .set('x-tenant-id', 'acme-corp')
      .send({
        requiredAttributes: { phone: true },
        kycPolicy: { required: true, minLevel: 'biometric_liveness' },
        allowedAuthMethods: { password: true, passkeys: true, federatedOidc: false },
      });

    expect(putRes.status).toBe(200);
    expect(putRes.body).toMatchObject({
      tenantId: 'acme-corp',
      isDefault: false,
      requiredAttributes: { phone: true },
      kycPolicy: { required: true, minLevel: 'biometric_liveness' },
      allowedAuthMethods: { password: true, passkeys: true, federatedOidc: false },
    });

    const getRes = await request(app)
      .get('/api/v1/tenants/acme-corp/policy')
      .set('Authorization', `Bearer ${memberToken}`)
      .set('x-tenant-id', 'acme-corp');

    expect(getRes.status).toBe(200);
    expect(getRes.body.isDefault).toBe(false);
    expect(getRes.body.requiredAttributes.phone).toBe(true);
    expect(getRes.body.kycPolicy).toEqual({ required: true, minLevel: 'biometric_liveness' });

    const auditEvent = loggedEvents.find((e) => e.eventType === 'TENANT_POLICY_UPDATED');
    expect(auditEvent).toBeDefined();
    expect(auditEvent?.tenantId).toBe('acme-corp');
  });

  it('should allow system:superadmin to read and update any tenant policy', async () => {
    const putRes = await request(app)
      .put('/api/v1/tenants/globex/policy')
      .set('Authorization', `Bearer ${superadminToken}`)
      .set('x-tenant-id', 'system')
      .send({
        requiredAttributes: { phone: false },
        kycPolicy: { required: true, minLevel: 'biometric_liveness' },
        allowedAuthMethods: { password: false, passkeys: true, federatedOidc: true },
      });

    expect(putRes.status).toBe(200);
    expect(putRes.body.tenantId).toBe('globex');
    expect(putRes.body.kycPolicy.minLevel).toBe('biometric_liveness');

    const getRes = await request(app)
      .get('/api/v1/tenants/globex/policy')
      .set('Authorization', `Bearer ${superadminToken}`)
      .set('x-tenant-id', 'system');

    expect(getRes.status).toBe(200);
    expect(getRes.body.kycPolicy.minLevel).toBe('biometric_liveness');
  });

  it('should reject disabling all authentication methods with 400 invalid_tenant_policy', async () => {
    const res = await request(app)
      .put('/api/v1/tenants/acme-corp/policy')
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .set('x-tenant-id', 'acme-corp')
      .send({
        allowedAuthMethods: { password: false, passkeys: false, federatedOidc: false },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_tenant_policy');
  });
});
