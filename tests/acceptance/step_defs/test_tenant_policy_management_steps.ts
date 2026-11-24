import http from 'http';
import request from 'supertest';
import { createApp } from '../../../interfaces/http/server';
import { JwtTokenAdapter } from '../../../src/contexts/identity/infrastructure/security/jwt_adapter';
import {
  SecurityAuditLoggerPort,
  SecurityAuditEvent,
} from '../../../src/contexts/identity/application/ports/security/audit_logger';

describe('Feature: TenantPolicy Aggregate & Configurable Capabilities Management (US-30)', () => {
  let server: http.Server;
  let memberToken: string;
  let adminToken: string;
  let loggedEvents: SecurityAuditEvent[];

  beforeEach(async () => {
    const tokenProvider = new JwtTokenAdapter('bdd_secret_tenant_policy_32_chars!');
    loggedEvents = [];
    const auditLogger: SecurityAuditLoggerPort = {
      logEvent: async (event: SecurityAuditEvent) => {
        loggedEvents.push(event);
      },
    };
    const app = createApp({ tokenProvider, auditLogger });

    memberToken = await tokenProvider.generateToken({
      userId: 'usr_bdd_member',
      tenantId: 'acme-corp',
      email: 'member@acme-corp.com',
      roles: ['member'],
    });

    adminToken = await tokenProvider.generateToken({
      userId: 'usr_bdd_admin',
      tenantId: 'acme-corp',
      email: 'admin@acme-corp.com',
      roles: ['tenant_admin'],
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

  describe('Scenario: Returning safe default policy when no custom policy exists', () => {
    it('returns 200 with isDefault true and safe default auth methods', async () => {
      const res = await request(server)
        .get('/api/v1/tenants/acme-corp/policy')
        .set('Authorization', `Bearer ${memberToken}`)
        .set('X-Tenant-ID', 'acme-corp');

      expect(res.status).toBe(200);
      expect(res.body.isDefault).toBe(true);
      expect(res.body.allowedAuthMethods).toEqual({
        password: true,
        passkeys: false,
        federatedOidc: true,
      });
    });
  });

  describe('Scenario: Updating policy as tenant_admin persists changes and emits audit event', () => {
    it('persists phone & biometric_liveness KYC and records TENANT_POLICY_UPDATED', async () => {
      const putRes = await request(server)
        .put('/api/v1/tenants/acme-corp/policy')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', 'acme-corp')
        .send({
          requiredAttributes: { phone: true },
          kycPolicy: { required: true, minLevel: 'biometric_liveness' },
          allowedAuthMethods: { password: true, passkeys: false, federatedOidc: true },
        });

      expect(putRes.status).toBe(200);
      expect(putRes.body.isDefault).toBe(false);

      const getRes = await request(server)
        .get('/api/v1/tenants/acme-corp/policy')
        .set('Authorization', `Bearer ${memberToken}`)
        .set('X-Tenant-ID', 'acme-corp');

      expect(getRes.status).toBe(200);
      expect(getRes.body.requiredAttributes.phone).toBe(true);
      expect(getRes.body.kycPolicy).toEqual({ required: true, minLevel: 'biometric_liveness' });
      expect(loggedEvents.some((e) => e.eventType === 'TENANT_POLICY_UPDATED')).toBe(true);
    });
  });

  describe('Scenario: Rejecting policy modification from member or cross-tenant actor', () => {
    it('returns 403 Forbidden for member role', async () => {
      const res = await request(server)
        .put('/api/v1/tenants/acme-corp/policy')
        .set('Authorization', `Bearer ${memberToken}`)
        .set('X-Tenant-ID', 'acme-corp')
        .send({ requiredAttributes: { phone: true } });

      expect(res.status).toBe(403);
    });
  });

  describe('Scenario: Rejecting policy that disables all authentication methods', () => {
    it('returns 400 with error invalid_tenant_policy', async () => {
      const res = await request(server)
        .put('/api/v1/tenants/acme-corp/policy')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', 'acme-corp')
        .send({
          allowedAuthMethods: { password: false, passkeys: false, federatedOidc: false },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_tenant_policy');
    });
  });
});
