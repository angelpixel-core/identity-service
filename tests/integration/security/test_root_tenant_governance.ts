import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '@interfaces/http/server';
import { InMemorySecurityAuditLogger } from '@identity/infrastructure/logging/memory_security_audit_logger';
import { JwtTokenAdapter } from '@identity/infrastructure/security/jwt_adapter';

describe('Integration Security: Root Tenant Platform Governance & Cross-Tenant Delegation (ADR-0009)', () => {
  let app: Express;
  let auditLogger: InMemorySecurityAuditLogger;
  let rootAdminToken: string;
  let rootAdminUserId: string;

  beforeEach(async () => {
    auditLogger = new InMemorySecurityAuditLogger();
    app = createApp({ auditLogger });

    // 1. Provision Platform Operator Root Superadmin in tenant 'system'
    const rootAdminRes = await request(app)
      .post('/api/v1/auth/register')
      .set('x-tenant-id', 'system')
      .send({
        email: `admin.${Date.now()}.${Math.random().toString(36).substring(7)}@angelpixel.io`,
        password: 'SuperAdminPassword2026!',
      });

    expect(rootAdminRes.status).toBe(201);
    expect(rootAdminRes.body).toHaveProperty('token');
    expect(rootAdminRes.body.tenantId).toBe('system');
    expect(rootAdminRes.body.roles).toContain('superadmin');

    rootAdminToken = rootAdminRes.body.token;
    rootAdminUserId = rootAdminRes.body.userId;
  });

  describe('Scenario 1: Platform Operator Token Verification & Claims', () => {
    it('should issue tokens with system tenantId, superadmin role, and platform_operator actorType', async () => {
      const jwtSecret = process.env.JWT_SECRET || 'default-jwt-secret-key-12345';
      const jwtAdapter = new JwtTokenAdapter(jwtSecret);

      const claims = await jwtAdapter.verifyToken(rootAdminToken);

      expect(claims.tenantId).toBe('system');
      expect(claims.userId).toBe(rootAdminUserId);
      expect(claims.roles).toEqual(['superadmin', 'member']);
      expect(claims.actorType).toBe('platform_operator');
    });
  });

  describe('Scenario 2: Delegated Cross-Tenant Access to Customer Organization', () => {
    let customerUserId: string;
    const targetTenant = 'tenant-customer-corp';

    beforeEach(async () => {
      // Provision regular user in customer tenant
      const customerRes = await request(app)
        .post('/api/v1/auth/register')
        .set('x-tenant-id', targetTenant)
        .send({
          email: `client.${Date.now()}@customer.com`,
          password: 'ClientPassword123!',
        });

      expect(customerRes.status).toBe(201);
      customerUserId = customerRes.body.userId;
    });

    it('should grant Root Superadmin read access across tenant boundaries with elevated audit logging', async () => {
      const res = await request(app)
        .get(`/api/v1/users/${customerUserId}`)
        .set('Authorization', `Bearer ${rootAdminToken}`)
        .set('x-tenant-id', targetTenant);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(customerUserId);
      expect(res.body.tenantId).toBe(targetTenant);

      // Verify PCI-DSS 10.2.2 / SOC 2 CC6.1 elevation audit log
      const events = auditLogger.getEvents();
      const elevatedEvent = events.find(
        (e: any) => e.eventType === 'platform_operator_cross_tenant_action' || e.eventType === 'PLATFORM_OPERATOR_CROSS_TENANT_ACTION'
      );

      expect(elevatedEvent).toBeDefined();
      expect(elevatedEvent?.status).toBe('GRANTED_ELEVATED');
      expect(elevatedEvent?.severity).toBe('WARN');
      expect(elevatedEvent?.tenantId).toBe(targetTenant);
      expect(elevatedEvent?.metadata).toEqual(
        expect.objectContaining({
          operatorTenantId: 'system',
          targetTenantId: targetTenant,
          userId: rootAdminUserId,
        })
      );
    });

    it('should grant Root Superadmin mutation (PATCH) and deletion (DELETE) access on customer resources', async () => {
      // 1. Delegated Update
      const patchRes = await request(app)
        .patch(`/api/v1/users/${customerUserId}`)
        .set('Authorization', `Bearer ${rootAdminToken}`)
        .set('x-tenant-id', targetTenant)
        .send({ name: 'Remediated Account' });

      expect(patchRes.status).toBe(200);

      // 2. Delegated Hard Delete
      const deleteRes = await request(app)
        .delete(`/api/v1/users/${customerUserId}`)
        .set('Authorization', `Bearer ${rootAdminToken}`)
        .set('x-tenant-id', targetTenant);

      expect(deleteRes.status).toBe(204);

      // 3. Verify customer user was physically purged
      const getAfterRes = await request(app)
        .get(`/api/v1/users/${customerUserId}`)
        .set('Authorization', `Bearer ${rootAdminToken}`)
        .set('x-tenant-id', targetTenant);

      expect(getAfterRes.status).toBe(404);
    });
  });

  describe('Scenario 3: Zero-Trust Invariant Penetration Testing', () => {
    it('should reject registration when superadmin role is explicitly requested in a commercial tenant', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .set('x-tenant-id', 'commercial-org')
        .send({
          email: 'imposter@commercial.com',
          password: 'Password123!',
          roles: ['superadmin'],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Role "superadmin" can only be assigned within the root tenant ("system")');
    });

    it('should block commercial tenant user from cross-tenant access with 403 Forbidden and log CROSS_TENANT_VIOLATION', async () => {
      // Register regular commercial user in tenant-alpha
      const alphaRes = await request(app)
        .post('/api/v1/auth/register')
        .set('x-tenant-id', 'tenant-alpha')
        .send({
          email: 'alice@alpha.com',
          password: 'Password123!',
        });
      const alphaToken = alphaRes.body.token;

      // Attempt cross-tenant access on tenant-beta
      const crossRes = await request(app)
        .get('/api/v1/users/any-user-id')
        .set('Authorization', `Bearer ${alphaToken}`)
        .set('x-tenant-id', 'tenant-beta');

      expect(crossRes.status).toBe(403);
      expect(crossRes.body.error).toContain('Forbidden');

      // Verify audit log captured the violation
      const events = auditLogger.getEvents();
      const violationEvent = events.find(
        (e: any) => e.eventType === 'cross_tenant_violation' || e.eventType === 'CROSS_TENANT_VIOLATION'
      );

      expect(violationEvent).toBeDefined();
      expect(violationEvent?.status).toBe('DENIED');
      expect(violationEvent?.severity).toBe('ALERT');
      expect(violationEvent?.metadata).toEqual(
        expect.objectContaining({
          activeTenantId: 'tenant-alpha',
          attemptedTenantId: 'tenant-beta',
        })
      );
    });
  });
});
