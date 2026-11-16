import { Writable } from 'stream';
import { ConsoleSecurityAuditLogger } from '../../../../../src/contexts/identity/infrastructure/logging/console_security_audit_logger';
import { SecurityAuditEvent } from '../../../../../src/contexts/identity/application/ports/security/audit_logger';

class MockWritableStream extends Writable {
  public readonly lines: string[] = [];

  _write(chunk: any, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.lines.push(chunk.toString());
    callback();
  }
}

describe('Infrastructure Adapter: ConsoleSecurityAuditLogger (12-Factor stdout NDJSON)', () => {
  let mockStream: MockWritableStream;
  let logger: ConsoleSecurityAuditLogger;

  beforeEach(() => {
    mockStream = new MockWritableStream();
    logger = new ConsoleSecurityAuditLogger({ outputStream: mockStream });
  });

  it('should emit a valid single-line NDJSON terminated with newline', async () => {
    const event: SecurityAuditEvent = {
      eventType: 'AUTH_LOGIN_SUCCESS',
      timestamp: new Date('2026-11-16T15:00:00.000Z'),
      tenantId: 'alpha-corp',
      actor: {
        userId: 'usr_123',
        type: 'USER',
        ip: '10.244.0.5',
      },
      trace: {
        requestId: 'req_xyz789',
        correlationId: 'corr_abc456',
      },
      action: 'oauth2_token_issued',
      status: 'SUCCESS',
      details: { grantType: 'authorization_code' },
    };

    await logger.logEvent(event);

    expect(mockStream.lines).toHaveLength(1);
    const line = mockStream.lines[0]!;
    expect(line.endsWith('\n')).toBe(true);

    const stripped = line.trimEnd();
    expect(stripped).not.toContain('\n');
    expect(stripped).not.toContain('\r');

    const parsed = JSON.parse(stripped);
    expect(parsed).toEqual({
      timestamp: '2026-11-16T15:00:00.000Z',
      logType: 'SECURITY_AUDIT',
      eventType: 'AUTH_LOGIN_SUCCESS',
      severity: 'INFO',
      tenantId: 'alpha-corp',
      actor: {
        userId: 'usr_123',
        type: 'USER',
        ip: '10.244.0.5',
      },
      trace: {
        requestId: 'req_xyz789',
        correlationId: 'corr_abc456',
      },
      compliance: {
        pciRequirement: '10.2.1',
        soc2Criteria: 'CC7.2',
        retentionCategory: 'AUDIT_IMMUTABLE',
      },
      action: 'oauth2_token_issued',
      status: 'SUCCESS',
      details: { grantType: 'authorization_code' },
    });
  });

  it('should sanitize sensitive credentials and patterns in the emitted NDJSON output', async () => {
    const event: SecurityAuditEvent = {
      eventType: 'client_authentication_failed',
      clientId: 'suspicious-client',
      timestamp: new Date('2026-11-16T15:05:00.000Z'),
      metadata: {
        password: 'PlainTextSecretPassword!',
        clientSecret: 'secret_live_key',
        embeddedToken: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDcSemACt8x4iTMCda8Yhe3iZaWbvV5XKSTbuAn0M',
      },
    };

    await logger.logEvent(event);

    expect(mockStream.lines).toHaveLength(1);
    const line = mockStream.lines[0]!;
    expect(line).not.toContain('PlainTextSecretPassword!');
    expect(line).not.toContain('secret_live_key');
    expect(line).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');

    const parsed = JSON.parse(line.trimEnd());
    expect(parsed.eventType).toBe('AUTH_LOGIN_FAILURE');
    expect(parsed.severity).toBe('WARN');
    expect(parsed.status).toBe('FAILURE');
    expect(parsed.details.password).toBe('[REDACTED]');
    expect(parsed.details.clientSecret).toBe('[REDACTED]');
    expect(parsed.details.embeddedToken).toBe('[REDACTED]');
  });

  it('should format legacy events with cross-tenant alerts properly', async () => {
    const event: SecurityAuditEvent = {
      eventType: 'cross_tenant_violation',
      clientId: 'client-org-1',
      timestamp: new Date('2026-11-16T15:10:00.000Z'),
      ip: '192.168.1.50',
      reason: 'Tenant mismatch detected',
    };

    await logger.logEvent(event);

    expect(mockStream.lines).toHaveLength(1);
    const parsed = JSON.parse(mockStream.lines[0]!.trimEnd());
    expect(parsed.eventType).toBe('CROSS_TENANT_VIOLATION');
    expect(parsed.severity).toBe('ALERT');
    expect(parsed.status).toBe('DENIED');
    expect(parsed.compliance.pciRequirement).toBe('10.2.5');
    expect(parsed.compliance.soc2Criteria).toBe('CC7.2');
    expect(parsed.compliance.retentionCategory).toBe('AUDIT_IMMUTABLE');
  });

  it('should use process.stdout when instantiated without custom stream', () => {
    const defaultLogger = new ConsoleSecurityAuditLogger();
    expect((defaultLogger as any).outputStream).toBe(process.stdout);
  });

  it('should be fail-safe: handle write stream errors gracefully without throwing', async () => {
    const faultyStream = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error('EPIPE: broken pipe'));
      },
    });

    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const faultyLogger = new ConsoleSecurityAuditLogger({ outputStream: faultyStream });

    const event: SecurityAuditEvent = {
      eventType: 'AUTH_LOGIN_SUCCESS',
      timestamp: new Date(),
    };

    // Should not throw
    await expect(faultyLogger.logEvent(event)).resolves.not.toThrow();

    stderrSpy.mockRestore();
  });
});
