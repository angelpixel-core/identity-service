import { buildCanonicalAuditEvent } from '../../../../../src/contexts/identity/application/security/audit_event_builder';
import { SecurityAuditEvent } from '../../../../../src/contexts/identity/application/ports/security/audit_logger';
import { REDACTED_VALUE } from '../../../../../src/contexts/identity/domain/security/audit_sanitizer';
import { TraceContext } from '../../../../../src/contexts/shared/domain/tracing/trace_context';
import { CorrelationContextStorage } from '../../../../../src/contexts/shared/infrastructure/tracing/correlation_context_storage';

describe('Application Security: AuditEventBuilder (US-19 Phase 1 Component 3)', () => {
  const fixedDate = new Date('2026-11-16T12:30:00.000Z');

  describe('Legacy Event Normalization & Defaults', () => {
    it('should map legacy client_authenticated to AUTH_LOGIN_SUCCESS with default INFO severity and SUCCESS status', () => {
      const raw: SecurityAuditEvent = {
        eventType: 'client_authenticated',
        clientId: 'order-service',
        timestamp: fixedDate,
        ip: '10.244.0.5',
        metadata: { scope: 'identity:read' },
      };

      const canonical = buildCanonicalAuditEvent(raw);

      expect(canonical.logType).toBe('SECURITY_AUDIT');
      expect(canonical.eventType).toBe('AUTH_LOGIN_SUCCESS');
      expect(canonical.severity).toBe('INFO');
      expect(canonical.status).toBe('SUCCESS');
      expect(canonical.action).toBe('auth_login_success');
      expect(canonical.timestamp).toBe(fixedDate.toISOString());
      expect(canonical.actor).toEqual({
        userId: 'order-service',
        type: 'CLIENT',
        ip: '10.244.0.5',
      });
      expect(canonical.details).toEqual({ scope: 'identity:read' });
      expect(canonical.compliance).toEqual({
        pciRequirement: '10.2.1',
        soc2Criteria: 'CC7.2',
        retentionCategory: 'AUDIT_IMMUTABLE',
      });
    });

    it('should map legacy cross_tenant_violation to CROSS_TENANT_VIOLATION with ALERT severity and DENIED status', () => {
      const raw: SecurityAuditEvent = {
        eventType: 'cross_tenant_violation',
        clientId: 'tenant-a-client',
        timestamp: fixedDate,
        ip: '192.168.1.100',
        reason: 'Tenant mismatch detected',
        metadata: { requestedTenant: 'tenant-b', tokenTenant: 'tenant-a' },
      };

      const canonical = buildCanonicalAuditEvent(raw);

      expect(canonical.eventType).toBe('CROSS_TENANT_VIOLATION');
      expect(canonical.severity).toBe('ALERT');
      expect(canonical.status).toBe('DENIED');
      expect(canonical.compliance?.pciRequirement).toBe('10.2.5');
      expect(canonical.compliance?.soc2Criteria).toBe('CC7.2');
      expect(canonical.details.reason).toBe('Tenant mismatch detected');
      expect(canonical.details.requestedTenant).toBe('tenant-b');
      expect(canonical.details.tokenTenant).toBe('tenant-a');
    });

    it('should map failure events to WARN severity and FAILURE status by default', () => {
      const raw: SecurityAuditEvent = {
        eventType: 'client_authentication_failed',
        clientId: 'unknown-service',
        timestamp: fixedDate,
        reason: 'invalid_client_secret',
      };

      const canonical = buildCanonicalAuditEvent(raw);

      expect(canonical.eventType).toBe('AUTH_LOGIN_FAILURE');
      expect(canonical.severity).toBe('WARN');
      expect(canonical.status).toBe('FAILURE');
      expect(canonical.details.reason).toBe('invalid_client_secret');
      expect(canonical.compliance?.pciRequirement).toBe('10.2.1');
    });
  });

  describe('Mandatory Banking Events & Explicit Overrides', () => {
    it('should preserve explicit banking eventType, severity, status, trace and tenantId', () => {
      const raw: SecurityAuditEvent = {
        logType: 'SECURITY_AUDIT',
        eventType: 'TOKEN_ISSUED',
        severity: 'INFO',
        timestamp: fixedDate,
        tenantId: 'alpha-corp',
        actor: {
          userId: 'usr_9b1deb4d',
          type: 'USER',
          ip: '10.244.0.12',
        },
        trace: {
          requestId: 'req_8f1b2c3d',
          correlationId: 'corr_9a8b7c',
        },
        compliance: {
          pciRequirement: '10.2.2',
          soc2Criteria: 'CC7.2',
          retentionCategory: 'AUDIT_IMMUTABLE',
        },
        action: 'oauth2_token_issued',
        status: 'SUCCESS',
        details: {
          grantType: 'authorization_code',
          expiresIn: 3600,
        },
      };

      const canonical = buildCanonicalAuditEvent(raw);

      expect(canonical.eventType).toBe('TOKEN_ISSUED');
      expect(canonical.tenantId).toBe('alpha-corp');
      expect(canonical.actor).toEqual({
        userId: 'usr_9b1deb4d',
        type: 'USER',
        ip: '10.244.0.12',
      });
      expect(canonical.trace).toEqual({
        requestId: 'req_8f1b2c3d',
        correlationId: 'corr_9a8b7c',
      });
      expect(canonical.compliance).toEqual({
        pciRequirement: '10.2.2',
        soc2Criteria: 'CC7.2',
        retentionCategory: 'AUDIT_IMMUTABLE',
      });
      expect(canonical.action).toBe('oauth2_token_issued');
      expect(canonical.status).toBe('SUCCESS');
      expect(canonical.details.grantType).toBe('authorization_code');
    });

    it('should assign PCI 10.2.6 for cryptographic secret rotation events', () => {
      const rawSuccess: SecurityAuditEvent = {
        eventType: 'secret_rotation_success',
        timestamp: fixedDate,
        details: { target: 'database-credentials' },
      };

      const rawFailure: SecurityAuditEvent = {
        eventType: 'secret_rotation_failure',
        timestamp: fixedDate,
        details: { target: 'jwt-keypair', error: 'Malformed PEM' },
      };

      const canonicalSuccess = buildCanonicalAuditEvent(rawSuccess);
      const canonicalFailure = buildCanonicalAuditEvent(rawFailure);

      expect(canonicalSuccess.eventType).toBe('SECRET_ROTATION_SUCCESS');
      expect(canonicalSuccess.compliance?.pciRequirement).toBe('10.2.6');
      expect(canonicalSuccess.severity).toBe('INFO');
      expect(canonicalSuccess.status).toBe('SUCCESS');

      expect(canonicalFailure.eventType).toBe('SECRET_ROTATION_FAILURE');
      expect(canonicalFailure.compliance?.pciRequirement).toBe('10.2.6');
      expect(canonicalFailure.severity).toBe('WARN');
      expect(canonicalFailure.status).toBe('FAILURE');
    });
  });

  describe('Deep Sanitization & Immutability', () => {
    it('should automatically sanitize sensitive keys and patterns in details and metadata', () => {
      const raw: SecurityAuditEvent = {
        eventType: 'client_authentication_failed',
        timestamp: fixedDate,
        metadata: {
          attemptedPassword: 'SuperSecretPassword!',
          clientSecret: 'secret_abc123',
          embeddedJwt: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDcSemACt8x4iTMCda8Yhe3iZaWbvV5XKSTbuAn0M',
          nested: {
            refreshToken: 'rt_confidential',
            cardNumber: '4111 2222 3333 4444',
          },
        },
      };

      const canonical = buildCanonicalAuditEvent(raw);

      expect(canonical.details.attemptedPassword).toBe(REDACTED_VALUE);
      expect(canonical.details.clientSecret).toBe(REDACTED_VALUE);
      expect(canonical.details.embeddedJwt).toBe(REDACTED_VALUE);
      expect((canonical.details.nested as any).refreshToken).toBe(REDACTED_VALUE);
      expect((canonical.details.nested as any).cardNumber).toBe(REDACTED_VALUE);
    });

    it('should freeze the returned canonical event to ensure immutability', () => {
      const raw: SecurityAuditEvent = {
        eventType: 'AUTH_LOGIN_SUCCESS',
        timestamp: fixedDate,
        details: { scope: 'read' },
      };

      const canonical = buildCanonicalAuditEvent(raw);

      expect(Object.isFrozen(canonical)).toBe(true);
      expect(() => {
        (canonical as any).severity = 'CRITICAL';
      }).toThrow();
    });
  });

  describe('Distributed Tracing Context Enrichment (US-20)', () => {
    const sampleTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const sampleSpanId = '00f067aa0ba902b7';
    const sampleRequestId = 'req-trace-enrich-456';

    it('should automatically infer traceId, spanId, traceparent, and requestId from CorrelationContextStorage', () => {
      const traceContext = TraceContext.create({
        traceId: sampleTraceId,
        spanId: sampleSpanId,
        traceFlags: '01',
        requestId: sampleRequestId,
      });

      CorrelationContextStorage.run(traceContext, () => {
        const raw: SecurityAuditEvent = {
          eventType: 'AUTH_LOGIN_SUCCESS',
          timestamp: fixedDate,
          details: { action: 'test' },
        };

        const canonical = buildCanonicalAuditEvent(raw);

        expect(canonical.trace.requestId).toBe(sampleRequestId);
        expect(canonical.trace.correlationId).toBe(sampleRequestId);
        expect(canonical.trace.traceId).toBe(sampleTraceId);
        expect(canonical.trace.spanId).toBe(sampleSpanId);
        expect(canonical.trace.traceparent).toBe(traceContext.toTraceparent());
      });
    });

    it('should respect explicitly provided trace fields over CorrelationContextStorage defaults', () => {
      const traceContext = TraceContext.createNew('req-from-storage');

      CorrelationContextStorage.run(traceContext, () => {
        const raw: SecurityAuditEvent = {
          eventType: 'AUTH_LOGIN_SUCCESS',
          timestamp: fixedDate,
          trace: {
            requestId: 'explicit-req-id',
            correlationId: 'explicit-corr-id',
            traceId: sampleTraceId,
            spanId: sampleSpanId,
            traceparent: `00-${sampleTraceId}-${sampleSpanId}-01`,
          },
        };

        const canonical = buildCanonicalAuditEvent(raw);

        expect(canonical.trace.requestId).toBe('explicit-req-id');
        expect(canonical.trace.correlationId).toBe('explicit-corr-id');
        expect(canonical.trace.traceId).toBe(sampleTraceId);
        expect(canonical.trace.spanId).toBe(sampleSpanId);
        expect(canonical.trace.traceparent).toBe(`00-${sampleTraceId}-${sampleSpanId}-01`);
      });
    });

    it('should leave trace fields undefined when running outside CorrelationContextStorage without explicit trace', () => {
      const raw: SecurityAuditEvent = {
        eventType: 'AUTH_LOGIN_SUCCESS',
        timestamp: fixedDate,
      };

      const canonical = buildCanonicalAuditEvent(raw);

      expect(canonical.trace.requestId).toBeUndefined();
      expect(canonical.trace.correlationId).toBeUndefined();
      expect(canonical.trace.traceId).toBeUndefined();
      expect(canonical.trace.spanId).toBeUndefined();
      expect(canonical.trace.traceparent).toBeUndefined();
    });
  });
});
