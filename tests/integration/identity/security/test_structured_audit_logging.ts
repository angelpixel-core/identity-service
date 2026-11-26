import { Writable } from 'stream';
import request from 'supertest';
import { Express } from 'express';
import { createApp } from '../../../../interfaces/http/server';
import { ConsoleSecurityAuditLogger } from '../../../../src/contexts/identity/infrastructure/logging/console_security_audit_logger';
import { JwtTokenAdapter } from '../../../../src/contexts/identity/infrastructure/security/jwt_adapter';

class MockWritableStream extends Writable {
  public readonly lines: string[] = [];

  _write(chunk: any, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.lines.push(chunk.toString());
    callback();
  }
}

describe('Integration E2E: Structured Security Audit Logging & NDJSON Ingestion (US-19)', () => {
  let mockStream: MockWritableStream;
  let auditLogger: ConsoleSecurityAuditLogger;
  let tokenProvider: JwtTokenAdapter;
  let app: Express;

  beforeEach(() => {
    mockStream = new MockWritableStream();
    auditLogger = new ConsoleSecurityAuditLogger({ outputStream: mockStream });
    tokenProvider = new JwtTokenAdapter('test_secret_for_audit_logging_32_chars!');

    app = createApp({
      auditLogger,
      tokenProvider,
    });
  });

  describe('Scenario 1 (BDD 1): Cross-Tenant Access Violation Detection', () => {
    it('should abort with 403 Forbidden and emit an ALERT NDJSON audit log when tenant mismatch is detected', async () => {
      // 1. Generar token legítimo para usuario de 'alpha-corp'
      const validToken = await tokenProvider.generateToken({
        userId: 'usr_attacker_99',
        tenantId: 'alpha-corp',
        email: 'attacker@alpha.com',
      });

      // 2. Intentar mutar recursos indicando 'beta-corp' en el payload
      const response = await request(app)
        .patch('/api/v1/users/usr_attacker_99')
        .set('Authorization', `Bearer ${validToken}`)
        .set('x-tenant-id', 'alpha-corp')
        .set('X-Request-ID', 'req_sec_audit_1001')
        .set('X-Correlation-ID', 'corr_sec_audit_2002')
        .send({ tenantId: 'beta-corp' });

      // 3. Verificar respuesta HTTP 403 Forbidden del Zero-Trust Guard
      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: 'Forbidden: Cross-tenant access violation detected',
      });

      // 4. Verificar que se emitió exactamente un registro NDJSON
      expect(mockStream.lines.length).toBeGreaterThanOrEqual(1);
      const auditLine = mockStream.lines.find((line) =>
        line.includes('CROSS_TENANT_VIOLATION')
      );
      expect(auditLine).toBeDefined();
      expect(auditLine!.endsWith('\n')).toBe(true);

      // 5. Validar conformidad estricta del esquema bancario en el NDJSON
      const parsed = JSON.parse(auditLine!.trimEnd());
      expect(parsed).toEqual(
        expect.objectContaining({
          logType: 'SECURITY_AUDIT',
          eventType: 'CROSS_TENANT_VIOLATION',
          severity: 'ALERT',
          status: 'DENIED',
          tenantId: 'alpha-corp',
          action: 'cross_tenant_access_denied',
          actor: expect.objectContaining({
            userId: 'usr_attacker_99',
            type: 'USER',
          }),
          trace: expect.objectContaining({
            requestId: 'req_sec_audit_1001',
            correlationId: 'corr_sec_audit_2002',
          }),
          compliance: {
            pciRequirement: '10.2.5',
            soc2Criteria: 'CC7.2',
            retentionCategory: 'AUDIT_IMMUTABLE',
          },
          details: expect.objectContaining({
            activeTenantId: 'alpha-corp',
            attemptedTenantId: 'beta-corp',
            reason: 'CROSS_TENANT_VIOLATION',
          }),
        })
      );
    });
  });

  describe('Scenario 2 (BDD 2): M2M Authentication & Strict Credential Redaction', () => {
    it('should reject invalid client credentials and ensure secrets are redacted in audit output', async () => {
      const confidentialSecret = 'MySuperConfidentialClientSecret_999!';

      const response = await request(app)
        .post('/api/v1/oauth2/token')
        .set('X-Request-ID', 'req_token_auth_5001')
        .send({
          grant_type: 'client_credentials',
          client_id: 'unregistered-client-id',
          client_secret: confidentialSecret,
        });

      expect(response.status).toBe(401);

      // Validar que NINGUNA línea del stream contenga el secreto en texto plano
      for (const line of mockStream.lines) {
        expect(line).not.toContain(confidentialSecret);
        if (line.includes('client_secret')) {
          expect(line).toContain('[REDACTED]');
        }
      }
    });
  });

  describe('Scenario 3: Correlation & Request ID Header Forwarding', () => {
    it('should preserve and forward client-supplied correlation headers into trace object', async () => {
      const token = await tokenProvider.generateToken({
        userId: 'usr_legit_42',
        tenantId: 'tenant-omega',
        email: 'legit@omega.com',
      });

      const response = await request(app)
        .patch('/api/v1/users/usr_legit_42')
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', 'tenant-omega')
        .set('X-Request-ID', 'req_trace_99999')
        .set('X-Correlation-ID', 'corr_trace_88888')
        .send({ tenantId: 'tenant-rogue' });

      expect(response.status).toBe(403);

      const auditLine = mockStream.lines.find((line) =>
        line.includes('req_trace_99999')
      );
      expect(auditLine).toBeDefined();
      const parsed = JSON.parse(auditLine!.trimEnd());

      expect(parsed.trace.requestId).toBe('req_trace_99999');
      expect(parsed.trace.correlationId).toBe('corr_trace_88888');
    });
  });

  describe('Scenario 4: Runtime Server Wiring Default Resolution', () => {
    it('should instantiate ConsoleSecurityAuditLogger by default when in production environment', () => {
      const prevEnv = process.env.NODE_ENV;
      const prevIdpKey = process.env.IDP_SECRET_ENCRYPTION_KEY;
      try {
        process.env.NODE_ENV = 'production';
        process.env.IDP_SECRET_ENCRYPTION_KEY = 'prod_test_key_for_audit_wiring_32_bytes!';
        const prodApp = createApp();
        expect(prodApp.locals.auditLogger).toBeInstanceOf(ConsoleSecurityAuditLogger);
      } finally {
        process.env.NODE_ENV = prevEnv;
        if (prevIdpKey === undefined) {
          delete process.env.IDP_SECRET_ENCRYPTION_KEY;
        } else {
          process.env.IDP_SECRET_ENCRYPTION_KEY = prevIdpKey;
        }
      }
    });
  });
});
