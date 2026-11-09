import http from 'http';
import request from 'supertest';
import { Express } from 'express';
import { createApp } from '../../../interfaces/http/server';
import { InMemorySecurityAuditLogger } from '../../../src/contexts/identity/infrastructure/logging/memory_security_audit_logger';
import { User } from '../../../src/contexts/identity/domain/entities/user/aggregate';
import { Email } from '../../../src/contexts/identity/domain/value_objects/email/value';
import { TenantId } from '../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { UserRepositoryPort } from '../../../src/contexts/identity/application/ports/user/repository';

describe('Feature: Cross-Tenant Zero-Trust Data Access Guard & Audit', () => {
  let app: Express;
  let server: http.Server;
  let auditLogger: InMemorySecurityAuditLogger;

  beforeEach((done) => {
    app = createApp();
    auditLogger = app.locals.auditLogger as InMemorySecurityAuditLogger;
    server = http.createServer(app);
    server.listen(0, done);
  });

  afterEach((done) => {
    if (server) {
      server.closeAllConnections?.();
      server.close(done);
    } else {
      done();
    }
  });

  describe('Scenario: Prevent user enumeration across tenant boundaries', () => {
    it('should respond with HTTP 404 Not Found and disclose no data when alpha-corp requests a beta-corp user ID', async () => {
      // Given an authenticated user belonging to tenant "alpha-corp"
      const alphaRegRes = await request(server)
        .post('/api/v1/auth/register')
        .set('x-tenant-id', 'alpha-corp')
        .send({
          email: 'operator@alpha-corp.com',
          password: 'Password123!',
        });

      expect(alphaRegRes.status).toBe(201);
      const alphaToken = alphaRegRes.body.token;

      // And an existing user profile with ID "user-999" belonging to tenant "beta-corp"
      const userRepository = app.locals.userRepository as UserRepositoryPort;
      const betaUser = User.reconstitute({
        id: 'user-999',
        email: Email.create('victim@beta-corp.com'),
        passwordHash: '$2b$06$hashedPasswordSampleForTestingOnly',
        tenantId: TenantId.create('beta-corp'),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await userRepository.save(betaUser);

      // When the user requests "/api/v1/users/user-999"
      const res = await request(server)
        .get('/api/v1/users/user-999')
        .set('Authorization', `Bearer ${alphaToken}`)
        .set('x-tenant-id', 'alpha-corp');

      // Then the system should respond with HTTP 404 Not Found
      expect(res.status).toBe(404);
      // And no profile data of "beta-corp" should be disclosed
      expect(res.body).not.toHaveProperty('email');
      expect(JSON.stringify(res.body)).not.toContain('victim@beta-corp.com');
      expect(JSON.stringify(res.body)).not.toContain('beta-corp');
    });
  });

  describe('Scenario: Block cross-tenant update attempts', () => {
    it('should abort operation with 403 Forbidden and log CROSS_TENANT_VIOLATION security audit event', async () => {
      // Given an authenticated user in tenant "alpha-corp"
      const alphaRegRes = await request(server)
        .post('/api/v1/auth/register')
        .set('x-tenant-id', 'alpha-corp')
        .send({
          email: 'attacker@alpha-corp.com',
          password: 'Password123!',
        });

      expect(alphaRegRes.status).toBe(201);
      const alphaToken = alphaRegRes.body.token;

      // When the user attempts to update a profile in tenant "beta-corp"
      const updateRes = await request(server)
        .patch('/api/v1/users/user-999')
        .set('Authorization', `Bearer ${alphaToken}`)
        .set('x-tenant-id', 'alpha-corp')
        .send({
          tenantId: 'beta-corp',
          email: 'compromised@beta-corp.com',
        });

      // Then the operation must be aborted
      expect(updateRes.status).toBe(403);

      // And a security audit event "CROSS_TENANT_VIOLATION" should be logged
      expect(auditLogger).toBeDefined();
      const events = auditLogger.getEvents();
      const violationEvent = events.find(
        (e) =>
          e.eventType === 'cross_tenant_violation' ||
          e.reason === 'CROSS_TENANT_VIOLATION'
      );
      expect(violationEvent).toBeDefined();
      expect(violationEvent?.metadata).toEqual(
        expect.objectContaining({
          activeTenantId: 'alpha-corp',
          attemptedTenantId: 'beta-corp',
        })
      );
    });
  });
});
