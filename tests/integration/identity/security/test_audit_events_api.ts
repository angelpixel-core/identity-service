import { Writable } from 'stream';
import request from 'supertest';
import { Express } from 'express';
import { createApp } from '../../../../interfaces/http/server';
import { ConsoleSecurityAuditLogger } from '../../../../src/contexts/identity/infrastructure/logging/console_security_audit_logger';
import { JwtTokenAdapter } from '../../../../src/contexts/identity/infrastructure/security/jwt_adapter';

class CaptureWritableStream extends Writable {
  public readonly lines: string[] = [];

  _write(chunk: any, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.lines.push(chunk.toString());
    callback();
  }
}

describe('Integration E2E: Live Security Audit Events API & Root Tenant Governance (US-19 & ADR-0009)', () => {
  let captureStream: CaptureWritableStream;
  let auditLogger: ConsoleSecurityAuditLogger;
  let tokenProvider: JwtTokenAdapter;
  let app: Express;
  let rootToken: string;
  let commercialUserToken: string;

  beforeEach(async () => {
    captureStream = new CaptureWritableStream();
    auditLogger = new ConsoleSecurityAuditLogger({
      outputStream: captureStream,
      maxRecentEvents: 100,
    });
    tokenProvider = new JwtTokenAdapter('test_secret_for_audit_api_32_chars_key!');

    app = createApp({
      auditLogger,
      tokenProvider,
    });

    rootToken = await tokenProvider.generateToken({
      userId: 'usr_root_auditor_01',
      tenantId: 'system',
      email: 'auditor@angelpixel.io',
      roles: ['superadmin', 'member'],
    });

    commercialUserToken = await tokenProvider.generateToken({
      userId: 'usr_alpha_99',
      tenantId: 'alpha-corp',
      email: 'member@alpha-corp.com',
      roles: ['member'],
    });
  });

  it('should reject unauthenticated requests with 401 Unauthorized', async () => {
    const res = await request(app).get('/api/v1/audit/events');
    expect(res.status).toBe(401);
  });

  it('should reject commercial tenant users with 403 Forbidden and emit CROSS_TENANT_VIOLATION', async () => {
    const denied = await request(app)
      .get('/api/v1/audit/events')
      .set('Authorization', `Bearer ${commercialUserToken}`);

    expect(denied.status).toBe(403);

    // Root superadmin inspects the real audit stream and confirms the violation was logged
    const inspect = await request(app)
      .get('/api/v1/audit/events?severity=ALERT')
      .set('Authorization', `Bearer ${rootToken}`);

    expect(inspect.status).toBe(200);
    expect(inspect.body.status).toBe('ACTIVE');
    expect(inspect.body.source).toBe('IN_PROCESS_SECURITY_AUDIT_RING_BUFFER');
    expect(inspect.body.count).toBeGreaterThanOrEqual(1);
    expect(inspect.body.events[0]).toEqual(
      expect.objectContaining({
        logType: 'SECURITY_AUDIT',
        eventType: 'CROSS_TENANT_VIOLATION',
        severity: 'ALERT',
        status: 'DENIED',
        tenantId: 'alpha-corp',
      })
    );
  });

  it('should capture real cross-tenant violations and M2M failures with W3C trace and [REDACTED] secrets', async () => {
    const sensitiveSecret = 'UltraSecretClientKey_2026!';

    // 1. Trigger cross-tenant violation with explicit W3C correlation headers
    const crossTenantRes = await request(app)
      .patch('/api/v1/users/usr_alpha_99')
      .set('Authorization', `Bearer ${commercialUserToken}`)
      .set('x-tenant-id', 'alpha-corp')
      .set('X-Request-ID', 'req-us19-live-001')
      .set('X-Correlation-ID', 'corr-us19-live-001')
      .send({ tenantId: 'beta-corp' });
    expect(crossTenantRes.status).toBe(403);

    // 2. Trigger M2M auth failure with a confidential client_secret
    const m2mRes = await request(app)
      .post('/api/v1/oauth2/token')
      .set('X-Request-ID', 'req-us19-m2m-002')
      .send({
        grant_type: 'client_credentials',
        client_id: 'rogue-billing-svc',
        client_secret: sensitiveSecret,
      });
    expect(m2mRes.status).toBe(401);

    // 3. Query real events via Root Tenant API
    const auditRes = await request(app)
      .get('/api/v1/audit/events?limit=10')
      .set('Authorization', `Bearer ${rootToken}`);

    expect(auditRes.status).toBe(200);
    expect(auditRes.body.count).toBeGreaterThanOrEqual(2);

    const serializedBody = JSON.stringify(auditRes.body);
    expect(serializedBody).not.toContain(sensitiveSecret);

    const crossTenantEvent = auditRes.body.events.find(
      (e: any) => e.trace?.requestId === 'req-us19-live-001'
    );
    expect(crossTenantEvent).toEqual(
      expect.objectContaining({
        eventType: 'CROSS_TENANT_VIOLATION',
        severity: 'ALERT',
        tenantId: 'alpha-corp',
        trace: expect.objectContaining({
          requestId: 'req-us19-live-001',
          correlationId: 'corr-us19-live-001',
        }),
        compliance: expect.objectContaining({
          pciRequirement: '10.2.5',
          retentionCategory: 'AUDIT_IMMUTABLE',
        }),
      })
    );
  });

  it('should filter by tenantId, severity, eventType, limit and reject invalid severity with 400', async () => {
    await auditLogger.logEvent({
      eventType: 'AUTH_LOGIN_SUCCESS',
      severity: 'INFO',
      tenantId: 'tenant-one',
      timestamp: new Date(),
    });
    await auditLogger.logEvent({
      eventType: 'CROSS_TENANT_VIOLATION',
      severity: 'ALERT',
      tenantId: 'tenant-two',
      timestamp: new Date(),
    });

    const filtered = await request(app)
      .get('/api/v1/audit/events?tenantId=tenant-two&severity=ALERT&eventType=CROSS_TENANT_VIOLATION&limit=5')
      .set('Authorization', `Bearer ${rootToken}`);

    expect(filtered.status).toBe(200);
    expect(filtered.body.count).toBe(1);
    expect(filtered.body.events[0].tenantId).toBe('tenant-two');
    expect(filtered.body.events[0].severity).toBe('ALERT');

    const badSeverity = await request(app)
      .get('/api/v1/audit/events?severity=BOGUS')
      .set('Authorization', `Bearer ${rootToken}`);
    expect(badSeverity.status).toBe(400);
    expect(badSeverity.body.error).toBe('invalid_severity');
  });

  it('should export valid NDJSON lines when format=ndjson is requested', async () => {
    await auditLogger.logEvent({
      eventType: 'SECRET_ROTATION_SUCCESS',
      severity: 'INFO',
      tenantId: 'system',
      timestamp: new Date(),
    });

    const ndjsonRes = await request(app)
      .get('/api/v1/audit/events?format=ndjson&limit=5')
      .set('Authorization', `Bearer ${rootToken}`);

    expect(ndjsonRes.status).toBe(200);
    expect(ndjsonRes.headers['content-type']).toContain('application/x-ndjson');

    const lines = ndjsonRes.text.trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.logType).toBe('SECURITY_AUDIT');
    expect(parsed.eventType).toBe('SECRET_ROTATION_SUCCESS');
  });
});
