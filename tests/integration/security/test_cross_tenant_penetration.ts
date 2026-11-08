import http from 'http';
import request from 'supertest';
import { Express } from 'express';
import { createApp } from '../../../interfaces/http/server';
import { InMemorySecurityAuditLogger } from '../../../src/contexts/identity/infrastructure/logging/memory_security_audit_logger';
import { User } from '../../../src/contexts/identity/domain/entities/user/aggregate';
import { Email } from '../../../src/contexts/identity/domain/value_objects/email/value';
import { TenantId } from '../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { UserRepositoryPort } from '../../../src/contexts/identity/application/ports/user/repository';
import { TenantSessionContext } from '../../../src/contexts/identity/domain/value_objects/tenant_session_context/value';
import { CrossTenantContextViolationError } from '../../../src/contexts/identity/domain/exceptions/security/error';

describe('Integration Security Harness: Cross-Tenant Zero-Trust Penetration Suite (US-06)', () => {
  let app: Express;
  let server: http.Server;
  let auditLogger: InMemorySecurityAuditLogger;
  let userRepository: UserRepositoryPort;
  let alphaToken: string;
  let alphaUserId: string;
  let betaToken: string;

  beforeEach(async () => {
    auditLogger = new InMemorySecurityAuditLogger();
    app = createApp({ auditLogger });
    userRepository = app.locals.userRepository as UserRepositoryPort;

    await new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(0, resolve);
    });

    // Provision authenticated user in alpha-corp
    const alphaRes = await request(server)
      .post('/api/v1/auth/register')
      .set('x-tenant-id', 'alpha-corp')
      .send({
        email: 'agent@alpha-corp.com',
        password: 'Password123!',
      });
    alphaToken = alphaRes.body.token;
    alphaUserId = alphaRes.body.userId;

    // Provision authenticated user in beta-corp
    const betaRes = await request(server)
      .post('/api/v1/auth/register')
      .set('x-tenant-id', 'beta-corp')
      .send({
        email: 'admin@beta-corp.com',
        password: 'Password123!',
      });
    betaToken = betaRes.body.token;

    // Seed target user-999 in beta-corp
    const targetBetaUser = User.reconstitute({
      id: 'user-999',
      email: Email.create('executive@beta-corp.com'),
      passwordHash: '$2b$06$hashedSecretForPenetrationTesting',
      tenantId: TenantId.create('beta-corp'),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await userRepository.save(targetBetaUser);
  });

  afterEach((done) => {
    if (server) {
      server.closeAllConnections?.();
      server.close(done);
    } else {
      done();
    }
  });

  describe('Vector 1: User Enumeration Prevention across Tenant Boundaries', () => {
    it('should return 404 Not Found when alpha-corp queries an existing user ID belonging to beta-corp', async () => {
      const res = await request(server)
        .get('/api/v1/users/user-999')
        .set('Authorization', `Bearer ${alphaToken}`)
        .set('x-tenant-id', 'alpha-corp');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'User not found' });
      expect(JSON.stringify(res.body)).not.toContain('executive@beta-corp.com');
    });

    it('should allow beta-corp user to retrieve user-999 within the legitimate tenant context', async () => {
      const res = await request(server)
        .get('/api/v1/users/user-999')
        .set('Authorization', `Bearer ${betaToken}`)
        .set('x-tenant-id', 'beta-corp');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          id: 'user-999',
          email: 'executive@beta-corp.com',
          tenantId: 'beta-corp',
        })
      );
      expect(res.body).not.toHaveProperty('passwordHash');
    });
  });

  describe('Vector 2: Cross-Tenant Profile Update & Mutation Blocking', () => {
    it('should abort with 403 Forbidden and log CROSS_TENANT_VIOLATION when payload targets another tenant', async () => {
      const res = await request(server)
        .patch('/api/v1/users/user-999')
        .set('Authorization', `Bearer ${alphaToken}`)
        .set('x-tenant-id', 'alpha-corp')
        .send({
          tenantId: 'beta-corp',
          email: 'pwned@beta-corp.com',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Forbidden');

      const events = auditLogger.getEvents();
      expect(events.length).toBeGreaterThanOrEqual(1);
      const auditEvent = events.find((e) => e.eventType === 'cross_tenant_violation');
      expect(auditEvent).toBeDefined();
      expect(auditEvent?.reason).toBe('CROSS_TENANT_VIOLATION');
      expect(auditEvent?.metadata).toEqual(
        expect.objectContaining({
          activeTenantId: 'alpha-corp',
          attemptedTenantId: 'beta-corp',
        })
      );

      // Verify beta-corp user remained untouched
      const untouchedUser = await userRepository.findById('user-999', TenantId.create('beta-corp'));
      expect(untouchedUser?.getEmail().getValue()).toBe('executive@beta-corp.com');
    });

    it('should return 404 Not Found when alpha-corp attempts to update user-999 under alpha-corp context', async () => {
      const res = await request(server)
        .patch('/api/v1/users/user-999')
        .set('Authorization', `Bearer ${alphaToken}`)
        .set('x-tenant-id', 'alpha-corp')
        .send({
          email: 'stealth@alpha-corp.com',
        });

      expect(res.status).toBe(404);

      const untouchedUser = await userRepository.findById('user-999', TenantId.create('beta-corp'));
      expect(untouchedUser?.getEmail().getValue()).toBe('executive@beta-corp.com');
    });

    it('should allow legitimate profile update within matching tenant context', async () => {
      const res = await request(server)
        .patch(`/api/v1/users/${alphaUserId}`)
        .set('Authorization', `Bearer ${alphaToken}`)
        .set('x-tenant-id', 'alpha-corp')
        .send({
          email: 'updated.agent@alpha-corp.com',
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          id: alphaUserId,
          email: 'updated.agent@alpha-corp.com',
          tenantId: 'alpha-corp',
        })
      );
    });
  });

  describe('Vector 3: Header Spoofing & Token-to-Header Divergence', () => {
    it('should block request with 403 Forbidden and emit CROSS_TENANT_VIOLATION when x-tenant-id header diverges from JWT claim', async () => {
      const res = await request(server)
        .get('/api/v1/users/user-999')
        .set('Authorization', `Bearer ${alphaToken}`)
        .set('x-tenant-id', 'beta-corp');

      expect(res.status).toBe(403);

      const events = auditLogger.getEvents();
      const violationEvent = events.find((e) => e.eventType === 'cross_tenant_violation');
      expect(violationEvent).toBeDefined();
      expect(violationEvent?.reason).toBe('CROSS_TENANT_VIOLATION');
      expect(violationEvent?.metadata).toEqual(
        expect.objectContaining({
          activeTenantId: 'alpha-corp',
          attemptedTenantId: 'beta-corp',
        })
      );
    });
  });

  describe('Vector 4: SQL Injection & Malformed Tenant Context Payloads', () => {
    const sqliVectors = [
      "' OR '1'='1",
      "alpha-corp'; DROP TABLE users; --",
      'alpha-corp" UNION SELECT * FROM users --',
      "alpha-corp'); SELECT set_config('app.current_tenant_id', 'beta-corp', false); --",
      '../beta-corp',
    ];

    it.each(sqliVectors)(
      'should reject malicious tenant header payload "%s" with 400 Bad Request',
      async (maliciousPayload) => {
        const res = await request(server)
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${alphaToken}`)
          .set('x-tenant-id', maliciousPayload);

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Invalid tenantId format');
      }
    );
  });

  describe('Vector 5: Domain Layer Zero-Trust Session Assertion', () => {
    it('should throw CrossTenantContextViolationError when asserting a mismatched target tenant', () => {
      const session = TenantSessionContext.create('alpha-corp');

      expect(() => session.assertMatchingTenant('beta-corp')).toThrow(
        CrossTenantContextViolationError
      );
    });
  });
});
