import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '@interfaces/http/server';
import { InMemorySecurityAuditLogger } from '@identity/infrastructure/logging/memory_security_audit_logger';
import type { DynamicPostgresPoolManager } from '@identity/infrastructure/persistence/database/dynamic_postgres_pool_manager';

describe('Integration API: /api/v1/secrets/* Zero-Downtime Secret Rotation & Root Governance (US-16 & ADR-0009)', () => {
  let app: Express;
  let auditLogger: InMemorySecurityAuditLogger;
  let rootToken: string;
  let commercialToken: string;
  let fakeGeneration: number;
  let fakePoolManager: Partial<DynamicPostgresPoolManager>;

  beforeEach(async () => {
    auditLogger = new InMemorySecurityAuditLogger();
    fakeGeneration = 1;

    fakePoolManager = {
      getGeneration: jest.fn(() => fakeGeneration),
      getStats: jest.fn(() => ({
        generation: fakeGeneration,
        activePoolTotalCount: 2,
        activePoolIdleCount: 2,
        activePoolWaitingCount: 0,
        retiringPoolsCount: fakeGeneration > 1 ? 1 : 0,
        isClosed: false,
      })),
      reloadCredentials: jest.fn(async (candidate: any) => {
        const url = typeof candidate === 'string' ? candidate : String(candidate?.connectionString || '');
        if (url.includes('bad_user') || url.includes('invalid')) {
          throw new Error('password authentication failed for user "bad_user"');
        }
        fakeGeneration += 1;
      }),
    };

    app = createApp({
      auditLogger,
      poolManager: fakePoolManager as DynamicPostgresPoolManager,
    });

    // Provision Root Superadmin in 'system'
    const rootRes = await request(app)
      .post('/api/v1/auth/register')
      .set('x-tenant-id', 'system')
      .send({
        email: `secadmin.${Date.now()}@angelpixel.io`,
        password: 'SuperAdminPassword2026!',
      });
    expect(rootRes.status).toBe(201);
    rootToken = rootRes.body.token;

    // Provision Commercial Tenant User in 'acme-corp'
    const commercialRes = await request(app)
      .post('/api/v1/auth/register')
      .set('x-tenant-id', 'acme-corp')
      .send({
        email: `dev.${Date.now()}@acme-corp.com`,
        password: 'EnterprisePassword2026!',
      });
    expect(commercialRes.status).toBe(201);
    commercialToken = commercialRes.body.token;
  });

  describe('Zero-Trust Root Tenant Authorization (ADR-0009)', () => {
    it('should reject unauthenticated requests with 401 Unauthorized', async () => {
      const res = await request(app).get('/api/v1/secrets/status');
      expect(res.status).toBe(401);
    });

    it('should reject commercial tenant users with 403 Forbidden and emit CROSS_TENANT_VIOLATION', async () => {
      const res = await request(app)
        .post('/api/v1/secrets/rotate-signing-key')
        .set('Authorization', `Bearer ${commercialToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Root Tenant (system) superadmin privileges');

      const deniedEvent = auditLogger
        .getEvents()
        .find((e) => e.eventType === 'CROSS_TENANT_VIOLATION' && e.status === 'DENIED');
      expect(deniedEvent).toBeDefined();
    });
  });

  describe('GET /api/v1/secrets/status', () => {
    it('should return active signing key telemetry and PostgreSQL pool generation for Root Superadmin', async () => {
      const res = await request(app)
        .get('/api/v1/secrets/status')
        .set('Authorization', `Bearer ${rootToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.signingKeys.jwksKeysCount).toBe(1);
      expect(res.body.signingKeys.retainedKeysCount).toBe(0);
      expect(res.body.databasePool.mode).toBe('DYNAMIC_POSTGRES_POOL');
      expect(res.body.databasePool.activeGeneration).toBe(1);
    });
  });

  describe('POST /api/v1/secrets/rotate-signing-key (Real RSA-2048 Rollover)', () => {
    it('should rotate the active RSA keypair in-process and expose both keys on /.well-known/jwks.json', async () => {
      const jwksBefore = await request(app).get('/.well-known/jwks.json');
      expect(jwksBefore.status).toBe(200);
      expect(jwksBefore.body.keys).toHaveLength(1);
      const originalKid = jwksBefore.body.keys[0].kid;

      const rotateRes = await request(app)
        .post('/api/v1/secrets/rotate-signing-key')
        .set('Authorization', `Bearer ${rootToken}`)
        .send({});

      expect(rotateRes.status).toBe(200);
      expect(rotateRes.body.status).toBe('SUCCESS');
      expect(rotateRes.body.operation).toBe('HOT_ASYMMETRIC_KEY_ROLLOVER');
      expect(rotateRes.body.previousKeyId).toBe(originalKid);
      expect(rotateRes.body.activeKeyId).not.toBe(originalKid);
      expect(rotateRes.body.jwksKeysCount).toBe(2);
      expect(rotateRes.body.retainedKeysCount).toBe(1);

      // Verify /.well-known/jwks.json exposes both keys (RFC 7517 grace window)
      const jwksAfter = await request(app).get('/.well-known/jwks.json');
      expect(jwksAfter.status).toBe(200);
      expect(jwksAfter.body.keys).toHaveLength(2);
      const kidsAfter = jwksAfter.body.keys.map((k: any) => k.kid);
      expect(kidsAfter).toContain(originalKid);
      expect(kidsAfter).toContain(rotateRes.body.activeKeyId);

      // Verify PCI-DSS 10.2.6 audit event
      const auditEvent = auditLogger
        .getEvents()
        .find((e) => e.eventType === 'SECRET_ROTATION_SUCCESS' && e.action === 'rsa_signing_key_rotated');
      expect(auditEvent).toBeDefined();
      expect(auditEvent?.compliance?.pciRequirement).toBe('10.2.6');
    });
  });

  describe('POST /api/v1/secrets/rotate-db-credentials (Generational Swap & Fail-Safe)', () => {
    it('should atomically promote PostgreSQL pool from Generation 1 to Generation 2 on valid credentials', async () => {
      const res = await request(app)
        .post('/api/v1/secrets/rotate-db-credentials')
        .set('Authorization', `Bearer ${rootToken}`)
        .send({ databaseUrl: 'postgresql://postgres:postgres@localhost:5432/identity_db' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('SUCCESS');
      expect(res.body.previousGeneration).toBe(1);
      expect(res.body.activeGeneration).toBe(2);
      expect(res.body.swapType).toBe('ATOMIC_POINTER_SWAP');

      const auditEvent = auditLogger
        .getEvents()
        .find((e) => e.eventType === 'SECRET_ROTATION_SUCCESS' && e.action === 'database_credentials_rotated');
      expect(auditEvent).toBeDefined();
    });

    it('should abort swap Fail-Safe with 422 and preserve active generation when candidate credentials fail pre-flight', async () => {
      const res = await request(app)
        .post('/api/v1/secrets/rotate-db-credentials')
        .set('Authorization', `Bearer ${rootToken}`)
        .send({ databaseUrl: 'postgresql://bad_user:wrong_pass@localhost:5432/identity_db' });

      expect(res.status).toBe(422);
      expect(res.body.status).toBe('FAILED_SAFE');
      expect(res.body.failSafePreserved).toBe(true);
      expect(res.body.activeGeneration).toBe(1);

      const failEvent = auditLogger
        .getEvents()
        .find((e) => e.eventType === 'SECRET_ROTATION_FAILURE' && e.status === 'FAILURE');
      expect(failEvent).toBeDefined();
      expect(failEvent?.severity).toBe('ALERT');
    });
  });
});
