import crypto from 'crypto';
import { ClientApplicationRepositoryPort } from '../../../domain/ports/client_application_repository_port';
import { HashProviderPort } from '../../ports/security/hash_provider';
import { TokenProviderPort } from '../../ports/security/token_provider';
import { SecurityAuditLoggerPort } from '../../ports/security/audit_logger';
import { InMemorySecurityAuditLogger } from '../../../infrastructure/logging/memory_security_audit_logger';
import { ClientId } from '../../../domain/value_objects/client_id/value';
import { ClientSecret } from '../../../domain/value_objects/client_secret/value';
import { DomainValidationError } from '../../../domain/exceptions/user/error';
import { OAuth2AuthenticationError } from '../../../domain/exceptions/oauth2/error';
import { AuthenticateClientM2MCommand } from './command';
import { OAuth2TokenResponseDTO } from '../../dtos/oauth2_token/dto';
import { MetricsPort } from '../../../../shared/domain/telemetry/metrics_port';

export interface AuthenticateClientM2MConfig {
  defaultExpiresInSeconds?: number;
  issuer?: string;
  audience?: string;
}

/**
 * Caso de Uso (Command): Autenticación de clientes confidenciales y emisión de token M2M (RFC 6749 Sección 4.4 & RFC 7519).
 */
export class AuthenticateClientM2MCommandHandler {
  private readonly defaultExpiresInSeconds: number;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(
    private readonly clientRepository: ClientApplicationRepositoryPort,
    private readonly hashProvider: HashProviderPort,
    private readonly tokenProvider: TokenProviderPort,
    private readonly auditLogger: SecurityAuditLoggerPort = new InMemorySecurityAuditLogger(),
    optionsOrExpiresIn: number | AuthenticateClientM2MConfig = 3600,
    private readonly metricsPort?: MetricsPort
  ) {
    if (typeof optionsOrExpiresIn === 'number') {
      this.defaultExpiresInSeconds = optionsOrExpiresIn;
      this.issuer = 'https://auth.angelpixel.io';
      this.audience = 'https://api.angelpixel.io';
    } else {
      this.defaultExpiresInSeconds = optionsOrExpiresIn.defaultExpiresInSeconds ?? 3600;
      this.issuer = optionsOrExpiresIn.issuer ?? 'https://auth.angelpixel.io';
      this.audience = optionsOrExpiresIn.audience ?? 'https://api.angelpixel.io';
    }
  }

  public async execute(command: AuthenticateClientM2MCommand): Promise<OAuth2TokenResponseDTO> {
    try {
      // 1. Validar grant_type
      if (!command.grantType || typeof command.grantType !== 'string' || command.grantType.trim().length === 0) {
        throw new OAuth2AuthenticationError(
          'invalid_request',
          'Missing grant_type parameter',
          400
        );
      }

      if (command.grantType !== 'client_credentials') {
        throw new OAuth2AuthenticationError(
          'unsupported_grant_type',
          `Unsupported grant_type: "${command.grantType}". Only "client_credentials" is supported on this endpoint.`,
          400
        );
      }

      // 2. Validar client_id
      if (!command.clientId || typeof command.clientId !== 'string' || command.clientId.trim().length === 0) {
        throw new OAuth2AuthenticationError(
          'invalid_request',
          'Missing client_id parameter',
          400
        );
      }

      let clientId: ClientId;
      try {
        clientId = ClientId.create(command.clientId);
      } catch (err: unknown) {
        const msg = err instanceof DomainValidationError ? err.message : 'Invalid client_id format';
        throw new OAuth2AuthenticationError(
          'invalid_client',
          `Client authentication failed: ${msg}`,
          401
        );
      }

      // 3. Recuperar agregado ClientApplication
      const client = await this.clientRepository.findByClientId(clientId);
      if (!client) {
        throw new OAuth2AuthenticationError(
          'invalid_client',
          `Client application "${clientId.getValue()}" was not found`,
          401
        );
      }

      // 4. Normalizar VO ClientSecret si fue provisto
      let clientSecret: ClientSecret | undefined;
      if (command.clientSecret && typeof command.clientSecret === 'string' && command.clientSecret.trim().length > 0) {
        try {
          clientSecret = ClientSecret.create(command.clientSecret);
        } catch {
          throw new OAuth2AuthenticationError(
            'invalid_client',
            'Client authentication failed: invalid client credentials',
            401
          );
        }
      }

      // 5. Validar concesión M2M y credenciales en el agregado de dominio
      await client.validateClientCredentialsGrant(clientSecret, this.hashProvider);

      // 6. Validar y normalizar scopes solicitados mediante el agregado
      let requestedScopes: string[] | undefined;
      if (command.scope && typeof command.scope === 'string' && command.scope.trim().length > 0) {
        requestedScopes = command.scope.trim().split(/\s+/).filter(Boolean);
      }

      const scopeResult = client.filterAuthorizedScopes(requestedScopes);
      if (!scopeResult.authorized) {
        throw new OAuth2AuthenticationError(
          'invalid_scope',
          `Requested scope "${scopeResult.unauthorizedScope}" is not authorized for client "${clientId.getValue()}"`,
          400
        );
      }

      const grantedScope = scopeResult.grantedScopes.length > 0 ? scopeResult.grantedScopes.join(' ') : undefined;

      // 7. Emitir token JWT con claims RFC 7519 y RFC 6749
      const jti = crypto.randomUUID();
      const access_token = await this.tokenProvider.generateToken({
        userId: clientId.getValue(),
        claims: {
          iss: this.issuer,
          aud: this.audience,
          sub: clientId.getValue(),
          client_id: clientId.getValue(),
          token_type: 'Bearer',
          jti,
          ...(grantedScope ? { scope: grantedScope } : {}),
        },
      });

      // 8. Registrar evento de auditoría exitoso
      await this.auditLogger.logEvent({
        eventType: 'client_authenticated',
        clientId: clientId.getValue(),
        timestamp: new Date(),
        ip: command.ip,
        metadata: {
          scope: grantedScope,
          token_type: 'Bearer',
          jti,
        },
      });

      this.metricsPort?.recordAuthAttempt({
        method: 'client_credentials',
        result: 'success',
      });

      this.metricsPort?.recordTokensIssued({
        grantType: 'client_credentials',
        tokenType: 'access',
      });

      return {
        access_token,
        token_type: 'Bearer',
        expires_in: this.defaultExpiresInSeconds,
        ...(grantedScope ? { scope: grantedScope } : {}),
      };
    } catch (err: unknown) {
      this.metricsPort?.recordAuthAttempt({
        method: 'client_credentials',
        result: 'failure',
      });

      const reason =
        err instanceof OAuth2AuthenticationError
          ? `${err.errorCode}: ${err.errorDescription}`
          : err instanceof Error
          ? err.message
          : 'unknown_authentication_error';

      await this.auditLogger.logEvent({
        eventType: 'client_authentication_failed',
        clientId: command.clientId || undefined,
        timestamp: new Date(),
        ip: command.ip,
        reason,
      });

      throw err;
    }
  }
}
