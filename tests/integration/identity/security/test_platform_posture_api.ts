import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '@interfaces/http/server';
import { InMemorySecurityAuditLogger } from '@identity/infrastructure/logging/memory_security_audit_logger';
import type { DynamicPostgresPoolManager } from '@identity/infrastructure/persistence/database/dynamic_postgres_pool_manager';

describe('Integration API: GET /api/v1/platform/posture (US-26 & ADR-0009)', () => {
  let app: Express;
  let auditLogger: InMemorySecurityAuditLogger;
  let rootToken: string;
  let commercialToken: string;
  let fakePoolManager: Partial<DynamicPostgresPoolManager>;

  beforeEach(async () => {
    auditLogger = new InMemorySecurityAuditLogger();

    fakePoolManager = {
      getGeneration: jest.fn(() => 2),
      getSslOptions: jest.fn(() => ({
        enabled: true,
        minVersion: 'TLSv1.2' as const,
        rejectUnauthorized: true,
      })),
      getStats: jest.fn(() => ({
        generation: 2,
        activePoolTotalCount: 4,
        activePoolIdleCount: 3,
        activePoolWaitingCount: 0,
        retiringPoolsCount: 0,
        isClosed: false,
      })),
    };

    app = createApp({
      auditLogger,
      poolManager: fakePoolManager as DynamicPostgresPoolManager,
    });

    const rootRes = await request(app)
      .post('/api/v1/auth/register')
      .set('x-tenant-id', 'system')
      .send({
        email: `platform.admin.${Date.now()}@angelpixel.io`,
        password: 'SuperAdminPassword2026!',
      });
    expect(rootRes.status).toBe(201);
    rootToken = rootRes.body.token;

    const commercialRes = await request(app)
      .post('/api/v1/auth/register')
      .set('x-tenant-id', 'acme-corp')
      .send({
        email: `tenant.user.${Date.now()}@acme-corp.com`,
        password: 'EnterprisePassword2026!',
      });
    expect(commercialRes.status).toBe(201);
    commercialToken = commercialRes.body.token;
  });

  it('should reject unauthenticated requests with 401 Unauthorized', async () => {
    const res = await request(app).get('/api/v1/platform/posture');
    expect(res.status).toBe(401);
  });

  it('should reject commercial tenant users with 403 Forbidden and log CROSS_TENANT_VIOLATION', async () => {
    const res = await request(app)
      .get('/api/v1/platform/posture')
      .set('Authorization', `Bearer ${commercialToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Root Tenant (system) superadmin privileges');

    const deniedEvent = auditLogger
      .getEvents()
      .find((e) => e.eventType === 'CROSS_TENANT_VIOLATION' && e.status === 'DENIED');
    expect(deniedEvent).toBeDefined();
  });

  it('should return complete read-only posture without plaintext secrets for Root Superadmin', async () => {
    const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

    const res = await request(app)
      .get('/api/v1/platform/posture')
      .set('Authorization', `Bearer ${rootToken}`)
      .set('traceparent', traceparent);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACTIVE');

    expect(res.body.governance).toMatchObject({
      rootTenantId: 'system',
      adr: 'ADR-0009',
      mode: 'READ_ONLY_POSTURE',
      actor: {
        tenantId: 'system',
      },
    });
    expect(res.body.governance.actor.roles).toContain('superadmin');

    expect(res.body.infrastructurePosture).toMatchObject({
      cloudIac: { story: 'US-12', status: 'VERIFIED_PARITY' },
      ingressTls: { story: 'US-13', protocol: 'TLS 1.3' },
      helmChart: { story: 'US-14', schemaValidation: 'STRICT' },
      cicdGuardrails: { story: 'US-15', nonRootUid: 1000 },
      networkPolicy: { story: 'US-18', defaultDenyAll: true },
    });

    expect(res.body.securityPosture).toMatchObject({
      rateLimiting: { enabled: true },
      securityHeaders: { helmetEnabled: true, corsStrict: true },
      databaseTls: {
        story: 'US-17',
        mode: 'DYNAMIC_POSTGRES_POOL',
        activeGeneration: 2,
        sslEnabled: true,
        rejectUnauthorized: true,
      },
    });

    expect(res.body.vaultMetadata.activeKeyId).toBeTruthy();
    expect(Array.isArray(res.body.vaultMetadata.exposedKids)).toBe(true);
    expect(res.body.vaultMetadata.jwksEndpoint).toBe('/.well-known/jwks.json');

    expect(res.body.observability.w3cTraceContext.propagatedTraceparent).toBe(traceparent);
    expect(res.body.observability.endpoints).toEqual({
      metrics: '/metrics',
      liveness: '/health/live',
      readiness: '/health/ready',
    });

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('BEGIN PRIVATE KEY');
    expect(serialized).not.toContain('BEGIN RSA PRIVATE KEY');
    expect(serialized).not.toContain('clientSecretHash');
  });
});
