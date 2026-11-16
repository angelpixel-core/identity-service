import { RotateRefreshTokenCommand } from './command';
import { RotateRefreshTokenResultDto } from './dto';
import { RefreshSessionRepositoryPort } from '../../../domain/ports/repositories/refresh_session_repository_port';
import { AsymmetricKeyProviderPort } from '../../../domain/ports/crypto/asymmetric_key_provider_port';
import { SecurityAuditLoggerPort } from '../../ports/security/audit_logger';
import { RefreshSession } from '../../../domain/entities/refresh_session/aggregate';
import { OAuth2AuthenticationError } from '../../../domain/exceptions/oauth2/error';
import { MetricsPort } from '../../../../shared/domain/telemetry/metrics_port';

export interface RotateRefreshTokenHandlerOptions {
  readonly issuerUrl?: string;
  readonly tokenLifetimeSeconds?: number;
}

/**
 * Caso de Uso: RotateRefreshTokenCommandHandler
 * Implementa la rotación estricta 1 a 1 de tokens de refresco y detección de reuso (US-09).
 */
export class RotateRefreshTokenCommandHandler {
  private readonly issuerUrl: string;
  private readonly tokenLifetimeSeconds: number;

  constructor(
    private readonly sessionRepository: RefreshSessionRepositoryPort,
    private readonly asymmetricKeyProvider: AsymmetricKeyProviderPort,
    private readonly auditLogger: SecurityAuditLoggerPort,
    options: RotateRefreshTokenHandlerOptions = {},
    private readonly metricsPort?: MetricsPort
  ) {
    this.issuerUrl = options.issuerUrl || 'https://auth.angelpixel.local';
    this.tokenLifetimeSeconds = options.tokenLifetimeSeconds || 3600;
  }

  public async execute(command: RotateRefreshTokenCommand): Promise<RotateRefreshTokenResultDto> {
    try {
      if (!command.refreshToken || typeof command.refreshToken !== 'string' || command.refreshToken.trim().length === 0) {
      throw new OAuth2AuthenticationError('invalid_request', 'Missing or empty refresh_token', 400);
    }

    let tokenHash: string;
    try {
      tokenHash = RefreshSession.hashToken(command.refreshToken.trim());
    } catch {
      throw new OAuth2AuthenticationError('invalid_grant', 'Invalid or malformed refresh token', 401);
    }

    const session = await this.sessionRepository.findByTokenHash(tokenHash);

    if (!session) {
      throw new OAuth2AuthenticationError('invalid_grant', 'Invalid or unknown refresh token', 401);
    }

    // Comprobar si fue consumido previamente (¡Detección de Reuso / Token Reuse Attack!)
    if (session.isConsumed()) {
      await this.sessionRepository.revokeFamily(session.getFamilyId(), 'reuse_detected');

      await this.auditLogger.logEvent({
        eventType: 'refresh_token_reuse_detected',
        clientId: session.getClientId().getValue(),
        timestamp: new Date(),
        ip: command.ip,
        reason: 'Refresh token reuse detected; entire token family revoked',
        metadata: {
          familyId: session.getFamilyId(),
          userId: session.getUserId(),
          tenantId: session.getTenantId().getValue(),
        },
      });

      throw new OAuth2AuthenticationError(
        'invalid_grant',
        'Refresh token has already been consumed. Session compromised and revoked.',
        401
      );
    }

    // Comprobar si la sesión fue revocada explícitamente
    if (session.isRevoked()) {
      throw new OAuth2AuthenticationError('invalid_grant', 'Refresh session has been revoked', 401);
    }

    // Comprobar expiración
    if (session.isExpired()) {
      throw new OAuth2AuthenticationError('invalid_grant', 'Refresh token has expired', 401);
    }

    // Generar nuevo token hijo en la misma familia
    const newPlainToken = RefreshSession.generatePlainToken();
    const newChildHash = RefreshSession.hashToken(newPlainToken);

    const now = new Date();
    const childSession = session.rotate(newChildHash, undefined, now);

    // Persistir estado consumido del token anterior y nuevo token activo
    await this.sessionRepository.save(session);
    await this.sessionRepository.save(childSession);

    // Emisión de Access Token RS256
    const accessPayload: Record<string, unknown> = {
      sub: session.getUserId(),
      iss: this.issuerUrl,
      aud: session.getClientId().getValue(),
      client_id: session.getClientId().getValue(),
      tenant_id: session.getTenantId().getValue(),
      scope: 'openid profile',
    };

    const accessToken = await this.asymmetricKeyProvider.signToken(accessPayload, {
      expiresIn: this.tokenLifetimeSeconds,
    });

    // Emisión de ID Token RS256
    const idPayload: Record<string, unknown> = {
      sub: session.getUserId(),
      iss: this.issuerUrl,
      aud: session.getClientId().getValue(),
      tenantId: session.getTenantId().getValue(),
    };

    const idToken = await this.asymmetricKeyProvider.signToken(idPayload, {
      expiresIn: this.tokenLifetimeSeconds,
    });

    this.metricsPort?.recordAuthAttempt({
      method: 'refresh_token',
      result: 'success',
      tenantId: session.getTenantId().getValue(),
    });

    this.metricsPort?.recordTokensIssued({
      grantType: 'refresh_token',
      tokenType: 'access',
      tenantId: session.getTenantId().getValue(),
    });

    this.metricsPort?.recordTokensIssued({
      grantType: 'refresh_token',
      tokenType: 'refresh',
      tenantId: session.getTenantId().getValue(),
    });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: this.tokenLifetimeSeconds,
      id_token: idToken,
      new_refresh_token: newPlainToken,
      family_id: session.getFamilyId(),
      user_id: session.getUserId(),
      tenant_id: session.getTenantId().getValue(),
    };
    } catch (err: unknown) {
      this.metricsPort?.recordAuthAttempt({
        method: 'refresh_token',
        result: 'failure',
      });
      throw err;
    }
  }
}

