import { ClientApplicationRepositoryPort } from '../../../../../src/contexts/identity/domain/ports/client_application_repository_port';
import { HashProviderPort } from '../../../../../src/contexts/identity/application/ports/security/hash_provider';
import { TokenProviderPort } from '../../../../../src/contexts/identity/application/ports/security/token_provider';
import { SecurityAuditLoggerPort } from '../../../../../src/contexts/identity/application/ports/security/audit_logger';
import { ClientApplication } from '../../../../../src/contexts/identity/domain/entities/client_application/aggregate';
import { ClientId } from '../../../../../src/contexts/identity/domain/value_objects/client_id/value';
import { OriginDomain } from '../../../../../src/contexts/identity/domain/value_objects/origin_domain/value';
import { AuthenticateClientM2MCommand } from '../../../../../src/contexts/identity/application/commands/authenticate_client_m2m/command';
import { AuthenticateClientM2MCommandHandler } from '../../../../../src/contexts/identity/application/commands/authenticate_client_m2m/handler';
import { OAuth2TokenResponseDTO } from '../../../../../src/contexts/identity/application/dtos/oauth2_token/dto';
import { InMemoryMetricsAdapter } from '../../../../../src/contexts/shared/domain/telemetry/in_memory_metrics_adapter';

describe('Application Command Handler: AuthenticateClientM2MCommandHandler (RFC 6749 Client Credentials & RFC 7519 JWT)', () => {
  let clientRepository: jest.Mocked<ClientApplicationRepositoryPort>;
  let hashProvider: jest.Mocked<HashProviderPort>;
  let tokenProvider: jest.Mocked<TokenProviderPort>;
  let auditLogger: jest.Mocked<SecurityAuditLoggerPort>;
  let handler: AuthenticateClientM2MCommandHandler;

  const validSecret = 'ValidSecret123!_SuperSecureSecretForTesting_2026';
  const validSecretHash = '$2b$10$hashedsecretpassword123';

  const activeConfidentialClient = ClientApplication.create({
    id: 'client-uuid-9001',
    clientId: ClientId.create('order-service'),
    clientSecretHash: validSecretHash,
    clientName: 'Order Microservice Satellite',
    clientType: 'confidential',
    allowedOrigins: [OriginDomain.create('https://orders.angelpixel.io')],
    redirectUris: [],
    allowedGrantTypes: ['client_credentials'],
    scopes: ['identity:read', 'orders:write'],
    isActive: true,
  });

  const activePublicClient = ClientApplication.create({
    id: 'client-uuid-9002',
    clientId: ClientId.create('portal-web'),
    clientName: 'Web Portal SPA',
    clientType: 'public',
    allowedOrigins: [OriginDomain.create('https://portal.angelpixel.io')],
    redirectUris: ['https://portal.angelpixel.io/callback'],
    allowedGrantTypes: ['authorization_code'],
    scopes: ['openid', 'profile'],
    isActive: true,
  });

  const deactivatedClient = ClientApplication.create({
    id: 'client-uuid-9003',
    clientId: ClientId.create('deactivated-worker'),
    clientSecretHash: validSecretHash,
    clientName: 'Deactivated Worker',
    clientType: 'confidential',
    allowedOrigins: [OriginDomain.create('https://worker.angelpixel.io')],
    redirectUris: [],
    allowedGrantTypes: ['client_credentials'],
    scopes: ['identity:read'],
    isActive: false,
  });

  beforeEach(() => {
    clientRepository = {
      save: jest.fn(),
      findByClientId: jest.fn(),
    };

    hashProvider = {
      hash: jest.fn(),
      compare: jest.fn(),
    };

    tokenProvider = {
      generateToken: jest.fn().mockResolvedValue('signed-jwt-token-m2m-sample'),
      verifyToken: jest.fn(),
    };

    auditLogger = {
      logEvent: jest.fn().mockResolvedValue(undefined),
    };

    handler = new AuthenticateClientM2MCommandHandler(
      clientRepository,
      hashProvider,
      tokenProvider,
      auditLogger,
      3600
    );
  });

  describe('Happy Path: Successful Client Credentials Grant', () => {
    it('should validate credentials, issue JWT with standard RFC 7519 claims, and log client_authenticated event', async () => {
      clientRepository.findByClientId.mockResolvedValueOnce(activeConfidentialClient);
      hashProvider.compare.mockResolvedValueOnce(true);

      const command: AuthenticateClientM2MCommand = {
        grantType: 'client_credentials',
        clientId: 'order-service',
        clientSecret: validSecret,
        scope: 'identity:read',
        ip: '192.168.1.50',
      };

      const result: OAuth2TokenResponseDTO = await handler.execute(command);

      expect(clientRepository.findByClientId).toHaveBeenCalledTimes(1);
      expect(hashProvider.compare).toHaveBeenCalledWith(validSecret, validSecretHash);

      // Verificación de claims estándar RFC 7519 (iss, aud, sub, client_id, token_type, jti, scope)
      expect(tokenProvider.generateToken).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'order-service',
          claims: expect.objectContaining({
            iss: 'https://auth.angelpixel.io',
            aud: 'https://api.angelpixel.io',
            sub: 'order-service',
            client_id: 'order-service',
            token_type: 'Bearer',
            scope: 'identity:read',
            jti: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
          }),
        })
      );

      // Verificación de registro de auditoría
      expect(auditLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'client_authenticated',
          clientId: 'order-service',
          ip: '192.168.1.50',
          metadata: expect.objectContaining({
            scope: 'identity:read',
            token_type: 'Bearer',
            jti: expect.any(String),
          }),
        })
      );

      expect(result).toEqual({
        access_token: 'signed-jwt-token-m2m-sample',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'identity:read',
      });
    });

    it('should default to all client granted scopes when scope parameter is omitted', async () => {
      clientRepository.findByClientId.mockResolvedValueOnce(activeConfidentialClient);
      hashProvider.compare.mockResolvedValueOnce(true);

      const command: AuthenticateClientM2MCommand = {
        grantType: 'client_credentials',
        clientId: 'order-service',
        clientSecret: validSecret,
      };

      const result = await handler.execute(command);

      expect(result.scope).toBe('identity:read orders:write');
    });

    it('should honor custom issuer, audience and expiration when configured', async () => {
      const customHandler = new AuthenticateClientM2MCommandHandler(
        clientRepository,
        hashProvider,
        tokenProvider,
        auditLogger,
        {
          issuer: 'https://custom-auth.example.com',
          audience: 'https://custom-api.example.com',
          defaultExpiresInSeconds: 7200,
        }
      );

      clientRepository.findByClientId.mockResolvedValueOnce(activeConfidentialClient);
      hashProvider.compare.mockResolvedValueOnce(true);

      const command: AuthenticateClientM2MCommand = {
        grantType: 'client_credentials',
        clientId: 'order-service',
        clientSecret: validSecret,
        scope: 'identity:read',
      };

      const result = await customHandler.execute(command);

      expect(result.expires_in).toBe(7200);
      expect(tokenProvider.generateToken).toHaveBeenCalledWith(
        expect.objectContaining({
          claims: expect.objectContaining({
            iss: 'https://custom-auth.example.com',
            aud: 'https://custom-api.example.com',
          }),
        })
      );
    });
  });

  describe('Protocol & Scope Invariant Violations (with Security Audit Logging)', () => {
    it('should throw invalid_request and log audit failure when grant_type is missing or empty', async () => {
      const command: AuthenticateClientM2MCommand = {
        grantType: '',
        clientId: 'order-service',
        clientSecret: validSecret,
      };

      await expect(handler.execute(command)).rejects.toMatchObject({
        errorCode: 'invalid_request',
        statusCode: 400,
      });

      expect(auditLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'client_authentication_failed',
          clientId: 'order-service',
          reason: expect.stringContaining('invalid_request'),
        })
      );
    });

    it('should throw unsupported_grant_type and log audit failure when grant_type is not client_credentials', async () => {
      const command: AuthenticateClientM2MCommand = {
        grantType: 'authorization_code',
        clientId: 'order-service',
        clientSecret: validSecret,
      };

      await expect(handler.execute(command)).rejects.toMatchObject({
        errorCode: 'unsupported_grant_type',
        statusCode: 400,
      });

      expect(auditLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'client_authentication_failed',
          clientId: 'order-service',
          reason: expect.stringContaining('unsupported_grant_type'),
        })
      );
    });

    it('should throw unauthorized_client and log audit failure when client is of type public', async () => {
      clientRepository.findByClientId.mockResolvedValueOnce(activePublicClient);

      const command: AuthenticateClientM2MCommand = {
        grantType: 'client_credentials',
        clientId: 'portal-web',
        clientSecret: '',
      };

      await expect(handler.execute(command)).rejects.toMatchObject({
        errorCode: 'unauthorized_client',
        statusCode: 400,
      });

      expect(auditLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'client_authentication_failed',
          clientId: 'portal-web',
          reason: expect.stringContaining('unauthorized_client'),
        })
      );
    });

    it('should throw invalid_scope and log audit failure when requested scope exceeds client registered scopes', async () => {
      clientRepository.findByClientId.mockResolvedValueOnce(activeConfidentialClient);
      hashProvider.compare.mockResolvedValueOnce(true);

      const command: AuthenticateClientM2MCommand = {
        grantType: 'client_credentials',
        clientId: 'order-service',
        clientSecret: validSecret,
        scope: 'identity:read identity:admin',
      };

      await expect(handler.execute(command)).rejects.toMatchObject({
        errorCode: 'invalid_scope',
        statusCode: 400,
      });

      expect(auditLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'client_authentication_failed',
          clientId: 'order-service',
          reason: expect.stringContaining('invalid_scope'),
        })
      );
    });
  });

  describe('Authentication Failures (with Security Audit Logging)', () => {
    it('should throw invalid_client and log audit failure when client_id does not exist', async () => {
      clientRepository.findByClientId.mockResolvedValueOnce(null);

      const command: AuthenticateClientM2MCommand = {
        grantType: 'client_credentials',
        clientId: 'unknown-service',
        clientSecret: validSecret,
        ip: '10.0.0.1',
      };

      await expect(handler.execute(command)).rejects.toMatchObject({
        errorCode: 'invalid_client',
        statusCode: 401,
      });

      expect(auditLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'client_authentication_failed',
          clientId: 'unknown-service',
          ip: '10.0.0.1',
          reason: expect.stringContaining('invalid_client'),
        })
      );
    });

    it('should throw invalid_client and log audit failure when client application is deactivated', async () => {
      clientRepository.findByClientId.mockResolvedValueOnce(deactivatedClient);

      const command: AuthenticateClientM2MCommand = {
        grantType: 'client_credentials',
        clientId: 'deactivated-worker',
        clientSecret: validSecret,
      };

      await expect(handler.execute(command)).rejects.toMatchObject({
        errorCode: 'invalid_client',
        statusCode: 401,
      });

      expect(auditLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'client_authentication_failed',
          clientId: 'deactivated-worker',
          reason: expect.stringContaining('invalid_client'),
        })
      );
    });

    it('should throw invalid_client and log audit failure when client secret verification fails', async () => {
      clientRepository.findByClientId.mockResolvedValueOnce(activeConfidentialClient);
      hashProvider.compare.mockResolvedValueOnce(false);

      const command: AuthenticateClientM2MCommand = {
        grantType: 'client_credentials',
        clientId: 'order-service',
        clientSecret: 'WrongSecret123!_SuperSecureSecretForTesting_2026',
      };

      await expect(handler.execute(command)).rejects.toMatchObject({
        errorCode: 'invalid_client',
        statusCode: 401,
      });

      expect(auditLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'client_authentication_failed',
          clientId: 'order-service',
          reason: expect.stringContaining('invalid_client'),
        })
      );
    });

    it('should throw invalid_client and log audit failure when client secret violates minimum entropy (< 32 chars)', async () => {
      clientRepository.findByClientId.mockResolvedValueOnce(activeConfidentialClient);

      const command: AuthenticateClientM2MCommand = {
        grantType: 'client_credentials',
        clientId: 'order-service',
        clientSecret: 'TooShortSecret123!',
      };

      await expect(handler.execute(command)).rejects.toMatchObject({
        errorCode: 'invalid_client',
        statusCode: 401,
      });

      expect(auditLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'client_authentication_failed',
          clientId: 'order-service',
          reason: expect.stringContaining('invalid_client'),
        })
      );
    });
  });

  describe('Structured Metrics Telemetry (US-21 Golden Signals)', () => {
    it('should record auth_attempts_total and auth_tokens_issued_total on successful authentication', async () => {
      const metricsAdapter = new InMemoryMetricsAdapter();
      const authSpy = jest.spyOn(metricsAdapter, 'recordAuthAttempt');
      const tokenSpy = jest.spyOn(metricsAdapter, 'recordTokensIssued');

      const instrumentedHandler = new AuthenticateClientM2MCommandHandler(
        clientRepository,
        hashProvider,
        tokenProvider,
        auditLogger,
        3600,
        metricsAdapter
      );

      clientRepository.findByClientId.mockResolvedValueOnce(activeConfidentialClient);
      hashProvider.compare.mockResolvedValueOnce(true);
      tokenProvider.generateToken.mockResolvedValueOnce('signed.jwt.access_token');

      const command: AuthenticateClientM2MCommand = {
        grantType: 'client_credentials',
        clientId: 'order-service',
        clientSecret: validSecret,
      };

      await instrumentedHandler.execute(command);

      expect(authSpy).toHaveBeenCalledTimes(1);
      expect(authSpy).toHaveBeenCalledWith({
        method: 'client_credentials',
        result: 'success',
      });

      expect(tokenSpy).toHaveBeenCalledTimes(1);
      expect(tokenSpy).toHaveBeenCalledWith({
        grantType: 'client_credentials',
        tokenType: 'access',
      });
    });

    it('should record auth_attempts_total with result=failure when authentication fails', async () => {
      const metricsAdapter = new InMemoryMetricsAdapter();
      const authSpy = jest.spyOn(metricsAdapter, 'recordAuthAttempt');

      const instrumentedHandler = new AuthenticateClientM2MCommandHandler(
        clientRepository,
        hashProvider,
        tokenProvider,
        auditLogger,
        3600,
        metricsAdapter
      );

      clientRepository.findByClientId.mockResolvedValueOnce(null);

      const command: AuthenticateClientM2MCommand = {
        grantType: 'client_credentials',
        clientId: 'unknown-client',
        clientSecret: validSecret,
      };

      await expect(instrumentedHandler.execute(command)).rejects.toThrow();

      expect(authSpy).toHaveBeenCalledTimes(1);
      expect(authSpy).toHaveBeenCalledWith({
        method: 'client_credentials',
        result: 'failure',
      });
    });
  });
});
