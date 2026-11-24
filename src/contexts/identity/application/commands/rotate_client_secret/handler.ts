import crypto from 'crypto';
import { ClientApplicationRepositoryPort } from '../../../domain/ports/client_application_repository_port';
import { ClientId } from '../../../domain/value_objects/client_id/value';
import { DomainValidationError } from '../../../domain/exceptions/user/error';
import { OAuth2AuthenticationError } from '../../../domain/exceptions/oauth2/error';
import { HashProviderPort } from '../../ports/security/hash_provider';
import { SecurityAuditLoggerPort } from '../../ports/security/audit_logger';
import { InMemorySecurityAuditLogger } from '../../../infrastructure/logging/memory_security_audit_logger';
import { RotateClientSecretCommand } from './command';

export interface RotateClientSecretResultDTO {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly secretGraceExpiresAt: string | null;
  readonly updatedAt: string;
}

/**
 * Caso de Uso (Command): Rotación de client_secret con ventana de gracia dual sin downtime (US-28).
 */
export class RotateClientSecretCommandHandler {
  constructor(
    private readonly clientRepository: ClientApplicationRepositoryPort,
    private readonly hashProvider: HashProviderPort,
    private readonly auditLogger: SecurityAuditLoggerPort = new InMemorySecurityAuditLogger()
  ) {}

  public async execute(command: RotateClientSecretCommand): Promise<RotateClientSecretResultDTO> {
    const clientId = ClientId.create(command.clientId);
    const client = await this.clientRepository.findByClientId(clientId);
    if (!client) {
      const notFound = new DomainValidationError(
        `Client application "${clientId.getValue()}" was not found`
      );
      (notFound as Error & { statusCode?: number }).statusCode = 404;
      throw notFound;
    }

    if (!command.isRootOperator && client.getTenantId() !== command.tenantId) {
      throw new OAuth2AuthenticationError(
        'access_denied',
        `Forbidden: client "${clientId.getValue()}" does not belong to tenant "${command.tenantId}"`,
        403
      );
    }

    const plainSecret = crypto.randomBytes(32).toString('base64url');
    const newSecretHash = await this.hashProvider.hash(plainSecret);
    const graceSeconds = command.gracePeriodSeconds ?? 0;

    client.rotateSecret(newSecretHash, graceSeconds);
    await this.clientRepository.save(client);

    await this.auditLogger.logEvent({
      eventType: 'CLIENT_SECRET_ROTATED',
      severity: 'INFO',
      status: 'SUCCESS',
      tenantId: client.getTenantId(),
      clientId: client.getClientId().getValue(),
      actor: command.actorUserId
        ? { userId: command.actorUserId, type: command.isRootOperator ? 'OPERATOR' : 'USER' }
        : { type: 'SYSTEM' },
      timestamp: new Date(),
      details: {
        gracePeriodSeconds: graceSeconds,
        secretGraceExpiresAt: client.getSecretGraceExpiresAt()?.toISOString() ?? null,
      },
    });

    return {
      clientId: client.getClientId().getValue(),
      clientSecret: plainSecret,
      secretGraceExpiresAt: client.getSecretGraceExpiresAt()
        ? client.getSecretGraceExpiresAt()!.toISOString()
        : null,
      updatedAt: client.getUpdatedAt().toISOString(),
    };
  }
}
