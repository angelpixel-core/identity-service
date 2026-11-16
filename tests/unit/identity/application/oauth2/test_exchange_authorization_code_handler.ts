import { ExchangeAuthorizationCodeCommandHandler } from '../../../../../src/contexts/identity/application/commands/exchange_authorization_code/handler';
import { InMemoryClientApplicationRepository } from '../../../../../src/contexts/identity/infrastructure/persistence/repositories/client_application/in_memory_client_repository';
import { InMemoryAuthorizationCodeRepository } from '../../../../../src/contexts/identity/infrastructure/persistence/repositories/authorization_code/in_memory_repository';
import { InMemorySecurityAuditLogger } from '../../../../../src/contexts/identity/infrastructure/logging/memory_security_audit_logger';
import { RsaKeyAdapter } from '../../../../../src/contexts/identity/infrastructure/security/rsa_key_adapter';
import { BcryptAdapter } from '../../../../../src/contexts/identity/infrastructure/security/bcrypt_adapter';
import { AuthorizationCode } from '../../../../../src/contexts/identity/domain/entities/authorization_code/entity';
import { ClientApplication } from '../../../../../src/contexts/identity/domain/entities/client_application/aggregate';
import { ClientId } from '../../../../../src/contexts/identity/domain/value_objects/client_id/value';
import { OriginDomain } from '../../../../../src/contexts/identity/domain/value_objects/origin_domain/value';
import { InMemoryMetricsAdapter } from '../../../../../src/contexts/shared/domain/telemetry/in_memory_metrics_adapter';

describe('Application Command: ExchangeAuthorizationCodeCommandHandler (RFC 6749 & RFC 7636)', () => {
  let clientRepository: InMemoryClientApplicationRepository;
  let authCodeRepository: InMemoryAuthorizationCodeRepository;
  let auditLogger: InMemorySecurityAuditLogger;
  let asymmetricKeyProvider: RsaKeyAdapter;
  let hashProvider: BcryptAdapter;
  let handler: ExchangeAuthorizationCodeCommandHandler;

  const validVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const expectedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

  beforeEach(async () => {
    clientRepository = new InMemoryClientApplicationRepository(true);
    authCodeRepository = new InMemoryAuthorizationCodeRepository();
    auditLogger = new InMemorySecurityAuditLogger();
    asymmetricKeyProvider = new RsaKeyAdapter();
    hashProvider = new BcryptAdapter(4);

    // Create a confidential client for testing client_secret exchange
    const secretHash = await hashProvider.hash('Secret123!_SuperSecureSecretForTesting');
    const confidentialClient = ClientApplication.create({
      id: 'confidential-app-uuid',
      clientId: ClientId.create('confidential-app'),
      clientSecretHash: secretHash,
      clientName: 'Confidential Web Client',
      clientType: 'confidential',
      allowedOrigins: [OriginDomain.create('https://backend.app.local')],
      redirectUris: ['https://backend.app.local/callback'],
      allowedGrantTypes: ['authorization_code'],
      scopes: ['openid', 'read:data'],
      isActive: true,
    });
    await clientRepository.save(confidentialClient);

    handler = new ExchangeAuthorizationCodeCommandHandler(
      clientRepository,
      authCodeRepository,
      hashProvider,
      asymmetricKeyProvider,
      auditLogger,
      900,
      'https://auth.company.local'
    );
  });

  it('should successfully exchange authorization code with PKCE for RS256 access_token and id_token', async () => {
    const authCode = AuthorizationCode.create({
      clientId: 'e-commerce-spa',
      userId: 'usr-456',
      tenantId: 'tenant-456',
      redirectUri: 'https://shop.local/callback',
      scope: 'openid profile',
      codeChallenge: expectedChallenge,
      codeChallengeMethod: 'S256',
      nonce: 'nonce-sample',
    });
    await authCodeRepository.save(authCode);

    const result = await handler.execute({
      grantType: 'authorization_code',
      clientId: 'e-commerce-spa',
      code: authCode.getCode(),
      redirectUri: 'https://shop.local/callback',
      codeVerifier: validVerifier,
    });

    expect(result.token_type).toBe('Bearer');
    expect(result.access_token).toBeDefined();
    expect(result.id_token).toBeDefined();
    expect(result.expires_in).toBe(900);
    expect(result.scope).toBe('openid profile');

    // Code must be marked as consumed
    const updatedCode = await authCodeRepository.findByCode(authCode.getCode());
    expect(updatedCode?.isConsumed()).toBe(true);

    // Verify token claims
    const decodedId = await asymmetricKeyProvider.verifyToken(result.id_token!);
    expect(decodedId.sub).toBe('usr-456');
    expect(decodedId.iss).toBe('https://auth.company.local');
    expect(decodedId.aud).toBe('e-commerce-spa');
    expect(decodedId.nonce).toBe('nonce-sample');
  });

  it('should successfully exchange for confidential client using clientSecret', async () => {
    const authCode = AuthorizationCode.create({
      clientId: 'confidential-app',
      userId: 'usr-admin',
      tenantId: 'tenant-corp',
      redirectUri: 'https://backend.app.local/callback',
      scope: 'openid read:data',
    });
    await authCodeRepository.save(authCode);

    const result = await handler.execute({
      grantType: 'authorization_code',
      clientId: 'confidential-app',
      clientSecret: 'Secret123!_SuperSecureSecretForTesting',
      code: authCode.getCode(),
      redirectUri: 'https://backend.app.local/callback',
    });

    expect(result.access_token).toBeDefined();
    expect(result.id_token).toBeDefined();
  });

  it('should reject when confidential client provides invalid secret', async () => {
    const authCode = AuthorizationCode.create({
      clientId: 'confidential-app',
      userId: 'usr-admin',
      tenantId: 'tenant-corp',
      redirectUri: 'https://backend.app.local/callback',
      scope: 'openid',
    });
    await authCodeRepository.save(authCode);

    try {
      await handler.execute({
        grantType: 'authorization_code',
        clientId: 'confidential-app',
        clientSecret: 'WrongSecret',
        code: authCode.getCode(),
        redirectUri: 'https://backend.app.local/callback',
      });
      fail('Expected to throw');
    } catch (err: any) {
      expect(err.errorCode).toBe('invalid_client');
      expect(err.statusCode).toBe(401);
    }
  });

  it('should detect replay attack when consumed code is exchanged a second time and log security event', async () => {
    const authCode = AuthorizationCode.create({
      clientId: 'e-commerce-spa',
      userId: 'usr-456',
      tenantId: 'tenant-456',
      redirectUri: 'https://shop.local/callback',
      scope: 'openid',
      codeChallenge: expectedChallenge,
      codeChallengeMethod: 'S256',
    });
    authCode.consume();
    await authCodeRepository.save(authCode);

    try {
      await handler.execute({
        grantType: 'authorization_code',
        clientId: 'e-commerce-spa',
        code: authCode.getCode(),
        redirectUri: 'https://shop.local/callback',
        codeVerifier: validVerifier,
      });
      fail('Expected to throw');
    } catch (err: any) {
      expect(err.errorCode).toBe('invalid_grant');
      expect(err.errorDescription).toContain('already been consumed');
    }

    const events = auditLogger.getEvents();
    expect(events.some((e) => e.eventType === 'code_reuse_violation')).toBe(true);
  });

  it('should reject when codeVerifier does not match codeChallenge, invalidate code, and log audit event', async () => {
    const authCode = AuthorizationCode.create({
      clientId: 'e-commerce-spa',
      userId: 'usr-456',
      tenantId: 'tenant-456',
      redirectUri: 'https://shop.local/callback',
      scope: 'openid',
      codeChallenge: expectedChallenge,
      codeChallengeMethod: 'S256',
    });
    await authCodeRepository.save(authCode);

    try {
      await handler.execute({
        grantType: 'authorization_code',
        clientId: 'e-commerce-spa',
        code: authCode.getCode(),
        redirectUri: 'https://shop.local/callback',
        codeVerifier: 'wrong_verifier_string_at_least_43_characters_long_for_testing',
      });
      fail('Expected to throw');
    } catch (err: any) {
      expect(err.errorCode).toBe('invalid_grant');
      expect(err.errorDescription).toContain('code_verifier does not match');
    }

    // Code must be immediately consumed to prevent brute force
    const consumedCode = await authCodeRepository.findByCode(authCode.getCode());
    expect(consumedCode?.isConsumed()).toBe(true);

    const events = auditLogger.getEvents();
    expect(events.some((e) => e.eventType === 'pkce_verification_failed')).toBe(true);
  });

  it('should reject when redirectUri does not match authorization step', async () => {
    const authCode = AuthorizationCode.create({
      clientId: 'e-commerce-spa',
      userId: 'usr-456',
      tenantId: 'tenant-456',
      redirectUri: 'https://shop.local/callback',
      scope: 'openid',
      codeChallenge: expectedChallenge,
      codeChallengeMethod: 'S256',
    });
    await authCodeRepository.save(authCode);

    try {
      await handler.execute({
        grantType: 'authorization_code',
        clientId: 'e-commerce-spa',
        code: authCode.getCode(),
        redirectUri: 'https://shop.local/different-callback',
        codeVerifier: validVerifier,
      });
      fail('Expected to throw');
    } catch (err: any) {
      expect(err.errorCode).toBe('invalid_grant');
      expect(err.errorDescription).toContain('redirect_uri does not match');
    }
  });

  it('should reject when code is expired', async () => {
    const authCode = AuthorizationCode.create({
      clientId: 'e-commerce-spa',
      userId: 'usr-456',
      tenantId: 'tenant-456',
      redirectUri: 'https://shop.local/callback',
      scope: 'openid',
      ttlSeconds: -10,
    });
    // Bypass in-memory repo auto-purge by setting directly or using save
    // Here we can save and check
    await authCodeRepository.save(authCode);

    try {
      await handler.execute({
        grantType: 'authorization_code',
        clientId: 'e-commerce-spa',
        code: authCode.getCode(),
        redirectUri: 'https://shop.local/callback',
        codeVerifier: validVerifier,
      });
      fail('Expected to throw');
    } catch (err: any) {
      expect(err.errorCode).toBe('invalid_grant');
    }
  });

  describe('Structured Metrics Telemetry (US-21 Golden Signals)', () => {
    it('should record auth_attempts_total and auth_tokens_issued_total on successful authorization_code exchange', async () => {
      const metricsAdapter = new InMemoryMetricsAdapter();
      const authSpy = jest.spyOn(metricsAdapter, 'recordAuthAttempt');
      const tokenSpy = jest.spyOn(metricsAdapter, 'recordTokensIssued');

      const instrumentedHandler = new ExchangeAuthorizationCodeCommandHandler(
        clientRepository,
        authCodeRepository,
        hashProvider,
        asymmetricKeyProvider,
        auditLogger,
        900,
        'http://localhost:4000',
        metricsAdapter
      );

      const authCode = AuthorizationCode.create({
        clientId: 'e-commerce-spa',
        userId: 'usr-123',
        tenantId: 'tenant-metrics',
        redirectUri: 'https://shop.local/callback',
        scope: 'openid profile',
        codeChallenge: expectedChallenge,
        codeChallengeMethod: 'S256',
        ttlSeconds: 60,
      });
      await authCodeRepository.save(authCode);

      await instrumentedHandler.execute({
        grantType: 'authorization_code',
        clientId: 'e-commerce-spa',
        code: authCode.getCode(),
        redirectUri: 'https://shop.local/callback',
        codeVerifier: validVerifier,
      });

      expect(authSpy).toHaveBeenCalledWith({
        method: 'authorization_code',
        result: 'success',
        tenantId: 'tenant-metrics',
      });

      expect(tokenSpy).toHaveBeenCalledWith({
        grantType: 'authorization_code',
        tokenType: 'access',
        tenantId: 'tenant-metrics',
      });

      expect(tokenSpy).toHaveBeenCalledWith({
        grantType: 'authorization_code',
        tokenType: 'id',
        tenantId: 'tenant-metrics',
      });
    });

    it('should record auth_attempts_total with result=failure when exchange fails', async () => {
      const metricsAdapter = new InMemoryMetricsAdapter();
      const authSpy = jest.spyOn(metricsAdapter, 'recordAuthAttempt');

      const instrumentedHandler = new ExchangeAuthorizationCodeCommandHandler(
        clientRepository,
        authCodeRepository,
        hashProvider,
        asymmetricKeyProvider,
        auditLogger,
        900,
        'http://localhost:4000',
        metricsAdapter
      );

      await expect(
        instrumentedHandler.execute({
          grantType: 'authorization_code',
          clientId: 'unknown-client',
          code: 'nonexistent-code',
          redirectUri: 'https://shop.local/callback',
        })
      ).rejects.toThrow();

      expect(authSpy).toHaveBeenCalledWith({
        method: 'authorization_code',
        result: 'failure',
      });
    });
  });
});
