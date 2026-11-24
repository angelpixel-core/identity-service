import { ClientApplicationRepositoryPort } from '../../../domain/ports/client_application_repository_port';
import { ClientId } from '../../../domain/value_objects/client_id/value';
import { OriginDomain } from '../../../domain/value_objects/origin_domain/value';
import { DomainValidationError } from '../../../domain/exceptions/user/error';
import { OAuth2AuthenticationError } from '../../../domain/exceptions/oauth2/error';
import { SecurityAuditLoggerPort } from '../../ports/security/audit_logger';
import { InMemorySecurityAuditLogger } from '../../../infrastructure/logging/memory_security_audit_logger';
import { ClientSafeViewDTO, toClientSafeViewDTO } from '../register_client/handler';
import { UpdateClientCommand } from './command';

/**
 * Caso de Uso (Command): Actualización de configuración o suspensión/reactivación de cliente OAuth2 (US-28).
 */
export class UpdateClientCommandHandler {
  constructor(
    private readonly clientRepository: ClientApplicationRepositoryPort,
    private readonly auditLogger: SecurityAuditLoggerPort = new InMemorySecurityAuditLogger()
  ) {}

  public async execute(command: UpdateClientCommand): Promise<ClientSafeViewDTO> {
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

    const prevStatus = client.getStatus();

    const hasConfigChanges =
      command.clientName !== undefined ||
      command.allowedOrigins !== undefined ||
      command.redirectUris !== undefined ||
      command.allowedGrantTypes !== undefined ||
      command.scopes !== undefined;

    if (hasConfigChanges) {
      client.updateConfiguration({
        clientName: command.clientName,
        allowedOrigins: command.allowedOrigins?.map((o) => OriginDomain.create(o)),
        redirectUris: command.redirectUris,
        allowedGrantTypes: command.allowedGrantTypes,
        scopes: command.scopes,
      });
    }

    if (command.status !== undefined) {
      if (command.status === 'suspended') {
        client.suspend();
      } else if (command.status === 'active') {
        client.reactivate();
      } else {
        throw new DomainValidationError(
          `Invalid client status "${String(command.status)}". Allowed: active, suspended.`
        );
      }
    }

    await this.clientRepository.save(client);

    const newStatus = client.getStatus();
    const eventType =
      prevStatus !== newStatus
        ? newStatus === 'suspended'
          ? 'CLIENT_SUSPENDED'
          : 'CLIENT_REACTIVATED'
        : 'CLIENT_UPDATED';

    await this.auditLogger.logEvent({
      eventType,
      severity: newStatus === 'suspended' ? 'WARN' : 'INFO',
      status: 'SUCCESS',
      tenantId: client.getTenantId(),
      clientId: client.getClientId().getValue(),
      actor: command.actorUserId
        ? { userId: command.actorUserId, type: command.isRootOperator ? 'OPERATOR' : 'USER' }
        : { type: 'SYSTEM' },
      timestamp: new Date(),
      details: {
        status: newStatus,
        crossTenantOperator: Boolean(command.isRootOperator && client.getTenantId() !== command.tenantId),
      },
    });

    return toClientSafeViewDTO(client);
  }
}
