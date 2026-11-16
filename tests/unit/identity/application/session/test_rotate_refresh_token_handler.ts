import { RotateRefreshTokenCommandHandler } from '../../../../../src/contexts/identity/application/commands/rotate_refresh_token/handler';
import { InMemoryRefreshSessionRepository } from '../../../../../src/contexts/identity/infrastructure/persistence/repositories/refresh_session/in_memory_repository';
import { InMemorySecurityAuditLogger } from '../../../../../src/contexts/identity/infrastructure/logging/memory_security_audit_logger';
import { RsaKeyAdapter } from '../../../../../src/contexts/identity/infrastructure/security/rsa_key_adapter';
import { RefreshSession } from '../../../../../src/contexts/identity/domain/entities/refresh_session/aggregate';
import { InMemoryMetricsAdapter } from '../../../../../src/contexts/shared/domain/telemetry/in_memory_metrics_adapter';

describe('Application Command: RotateRefreshTokenCommandHandler (US-09)', () => {
  let sessionRepository: InMemoryRefreshSessionRepository;
  let auditLogger: InMemorySecurityAuditLogger;
  let asymmetricKeyProvider: RsaKeyAdapter;
  let handler: RotateRefreshTokenCommandHandler;

  beforeEach(() => {
    sessionRepository = new InMemoryRefreshSessionRepository();
    auditLogger = new InMemorySecurityAuditLogger();
    asymmetricKeyProvider = new RsaKeyAdapter();
    handler = new RotateRefreshTokenCommandHandler(
      sessionRepository,
      asymmetricKeyProvider,
      auditLogger,
      {
        issuerUrl: 'https://auth.test.local',
        tokenLifetimeSeconds: 900,
      }
    );
  });

  it('should successfully rotate an active session and issue RS256 access and id tokens', async () => {
    const { session, plainToken } = RefreshSession.create({
      familyId: 'fam-handler-1',
      userId: 'usr-1',
      tenantId: 'tenant-1',
      clientId: 'e-commerce-spa',
    });
    await sessionRepository.save(session);

    const result = await handler.execute({
      refreshToken: plainToken,
      clientId: 'e-commerce-spa',
      ip: '127.0.0.1',
    });

    expect(result).toBeDefined();
    expect(result.access_token).toBeDefined();
    expect(result.token_type).toBe('Bearer');
    expect(result.expires_in).toBe(900);
    expect(result.id_token).toBeDefined();
    expect(result.new_refresh_token).toBeDefined();
    expect(result.new_refresh_token).not.toBe(plainToken);
    expect(result.family_id).toBe('fam-handler-1');
    expect(result.user_id).toBe('usr-1');

    // Verify parent is marked as consumed
    const parentSession = await sessionRepository.findByTokenHash(session.getTokenHash());
    expect(parentSession?.isConsumed()).toBe(true);

    // Verify child is active
    const childHash = RefreshSession.hashToken(result.new_refresh_token);
    const childSession = await sessionRepository.findByTokenHash(childHash);
    expect(childSession).not.toBeNull();
    expect(childSession?.isActive()).toBe(true);
    expect(childSession?.getFamilyId()).toBe('fam-handler-1');
  });

  it('should throw invalid_request (400) when refreshToken is empty or whitespace', async () => {
    await expect(
      handler.execute({
        refreshToken: '',
      })
    ).rejects.toMatchObject({
      errorCode: 'invalid_request',
      statusCode: 400,
    });
  });

  it('should throw invalid_grant (401) when refreshToken is unknown', async () => {
    await expect(
      handler.execute({
        refreshToken: 'unknown_token_string_at_least_16_characters',
      })
    ).rejects.toMatchObject({
      errorCode: 'invalid_grant',
      statusCode: 401,
    });
  });

  it('should throw invalid_grant (401) when refreshToken is expired', async () => {
    const pastExpiresAt = new Date(Date.now() - 5000);
    const { session, plainToken } = RefreshSession.create({
      userId: 'usr-expired',
      tenantId: 'tenant-1',
      clientId: 'e-commerce-spa',
      expiresAt: pastExpiresAt,
    });
    await sessionRepository.save(session);

    await expect(
      handler.execute({
        refreshToken: plainToken,
      })
    ).rejects.toMatchObject({
      errorCode: 'invalid_grant',
      statusCode: 401,
    });
  });

  it('should detect token reuse, revoke all family tokens, and log security alert event', async () => {
    const { session, plainToken } = RefreshSession.create({
      familyId: 'fam-replay-attack',
      userId: 'usr-victim',
      tenantId: 'tenant-1',
      clientId: 'e-commerce-spa',
    });

    // Legitimate rotation occurs first
    const childHash = RefreshSession.hashToken(RefreshSession.generatePlainToken());
    const childSession = session.rotate(childHash);
    await sessionRepository.save(session);
    await sessionRepository.save(childSession);

    // Attacker replays consumed token
    await expect(
      handler.execute({
        refreshToken: plainToken,
        ip: '198.51.100.1',
      })
    ).rejects.toMatchObject({
      errorCode: 'invalid_grant',
      statusCode: 401,
    });

    // Entire family must be revoked
    const family = await sessionRepository.findByFamilyId('fam-replay-attack');
    expect(family.every((s) => s.isRevoked())).toBe(true);

    // Audit event must be logged
    const events = await auditLogger.getEvents();
    const reuseEvent = events.find((e) => e.eventType === 'refresh_token_reuse_detected');
    expect(reuseEvent).toBeDefined();
    expect(reuseEvent?.metadata?.familyId).toBe('fam-replay-attack');
    expect(reuseEvent?.ip).toBe('198.51.100.1');
  });

  it('should throw invalid_grant (401) when session is already revoked', async () => {
    const { session, plainToken } = RefreshSession.create({
      userId: 'usr-revoked',
      tenantId: 'tenant-1',
      clientId: 'e-commerce-spa',
    });
    session.revoke('user_logout');
    await sessionRepository.save(session);

    await expect(
      handler.execute({
        refreshToken: plainToken,
      })
    ).rejects.toMatchObject({
      errorCode: 'invalid_grant',
      statusCode: 401,
    });
  });

  describe('Structured Metrics Telemetry (US-21 Golden Signals)', () => {
    it('should record auth_attempts_total and auth_tokens_issued_total on successful token rotation', async () => {
      const metricsAdapter = new InMemoryMetricsAdapter();
      const authSpy = jest.spyOn(metricsAdapter, 'recordAuthAttempt');
      const tokenSpy = jest.spyOn(metricsAdapter, 'recordTokensIssued');

      const instrumentedHandler = new RotateRefreshTokenCommandHandler(
        sessionRepository,
        asymmetricKeyProvider,
        auditLogger,
        {
          issuerUrl: 'https://auth.test.local',
          tokenLifetimeSeconds: 900,
        },
        metricsAdapter
      );

      const { session, plainToken } = RefreshSession.create({
        familyId: 'fam-metrics-1',
        userId: 'usr-metrics',
        tenantId: 'tenant-metrics-org',
        clientId: 'e-commerce-spa',
      });
      await sessionRepository.save(session);

      await instrumentedHandler.execute({
        refreshToken: plainToken,
      });

      expect(authSpy).toHaveBeenCalledWith({
        method: 'refresh_token',
        result: 'success',
        tenantId: 'tenant-metrics-org',
      });

      expect(tokenSpy).toHaveBeenCalledWith({
        grantType: 'refresh_token',
        tokenType: 'access',
        tenantId: 'tenant-metrics-org',
      });

      expect(tokenSpy).toHaveBeenCalledWith({
        grantType: 'refresh_token',
        tokenType: 'refresh',
        tenantId: 'tenant-metrics-org',
      });
    });

    it('should record auth_attempts_total with result=failure when token rotation fails', async () => {
      const metricsAdapter = new InMemoryMetricsAdapter();
      const authSpy = jest.spyOn(metricsAdapter, 'recordAuthAttempt');

      const instrumentedHandler = new RotateRefreshTokenCommandHandler(
        sessionRepository,
        asymmetricKeyProvider,
        auditLogger,
        {},
        metricsAdapter
      );

      await expect(
        instrumentedHandler.execute({
          refreshToken: 'invalid_refresh_token',
        })
      ).rejects.toThrow();

      expect(authSpy).toHaveBeenCalledWith({
        method: 'refresh_token',
        result: 'failure',
      });
    });
  });
});

