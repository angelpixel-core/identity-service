import crypto from 'crypto';
import {
  ClientApplication,
  ClientProfile,
  ClientStatus,
  ClientType,
} from '../../../domain/entities/client_application/aggregate';
import { ClientApplicationRepositoryPort } from '../../../domain/ports/client_application_repository_port';
import { ClientId } from '../../../domain/value_objects/client_id/value';
import { OriginDomain } from '../../../domain/value_objects/origin_domain/value';
import { DomainValidationError } from '../../../domain/exceptions/user/error';
import { HashProviderPort } from '../../ports/security/hash_provider';
import { SecurityAuditLoggerPort } from '../../ports/security/audit_logger';
import { InMemorySecurityAuditLogger } from '../../../infrastructure/logging/memory_security_audit_logger';
import { RegisterClientCommand } from './command';

export interface ClientSafeViewDTO {
  readonly id: string;
  readonly tenantId: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly clientType: ClientType;
  readonly clientProfile: ClientProfile;
  readonly status: ClientStatus;
  readonly isActive: boolean;
  readonly allowedOrigins: string[];
  readonly redirectUris: string[];
  readonly allowedGrantTypes: string[];
  readonly scopes: string[];
  readonly secretGraceExpiresAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RegisterClientResultDTO extends ClientSafeViewDTO {
  readonly clientSecret?: string;
}

export function resolveClientTypeAndProfile(
  rawType?: ClientType | ClientProfile,
  rawProfile?: ClientProfile
): { clientType: ClientType; clientProfile: ClientProfile } {
  const candidate = rawProfile ?? rawType ?? 'spa';
  switch (candidate) {
    case 'spa':
      return { clientType: 'public', clientProfile: 'spa' };
    case 'native':
      return { clientType: 'public', clientProfile: 'native' };
    case 'web':
      return { clientType: 'confidential', clientProfile: 'web' };
    case 'm2m':
      return { clientType: 'confidential', clientProfile: 'm2m' };
    case 'public':
      return { clientType: 'public', clientProfile: rawProfile ?? 'spa' };
    case 'confidential':
      return { clientType: 'confidential', clientProfile: rawProfile ?? 'm2m' };
    default:
      throw new DomainValidationError(
        `Invalid clientType/clientProfile: "${String(candidate)}". Allowed: spa, web, native, m2m, public, confidential.`
      );
  }
}

export function toClientSafeViewDTO(client: ClientApplication): ClientSafeViewDTO {
  return {
    id: client.getId(),
    tenantId: client.getTenantId(),
    clientId: client.getClientId().getValue(),
    clientName: client.getClientName(),
    clientType: client.getClientType(),
    clientProfile: client.getClientProfile(),
    status: client.getStatus(),
    isActive: client.isActive(),
    allowedOrigins: client.getAllowedOrigins().map((o) => o.getValue()),
    redirectUris: client.getRedirectUris(),
    allowedGrantTypes: client.getAllowedGrantTypes(),
    scopes: client.getScopes(),
    secretGraceExpiresAt: client.getSecretGraceExpiresAt()
      ? client.getSecretGraceExpiresAt()!.toISOString()
      : null,
    createdAt: client.getCreatedAt().toISOString(),
    updatedAt: client.getUpdatedAt().toISOString(),
  };
}

/**
 * Caso de Uso (Command): Alta de una aplicación cliente OAuth2/OIDC (US-28).
 */
export class RegisterClientCommandHandler {
  constructor(
    private readonly clientRepository: ClientApplicationRepositoryPort,
    private readonly hashProvider: HashProviderPort,
    private readonly auditLogger: SecurityAuditLoggerPort = new InMemorySecurityAuditLogger()
  ) {}

  public async execute(command: RegisterClientCommand): Promise<RegisterClientResultDTO> {
    const tenantId = command.tenantId?.trim();
    if (!tenantId) {
      throw new DomainValidationError('tenantId is required to register a client');
    }

    const { clientType, clientProfile } = resolveClientTypeAndProfile(
      command.clientType,
      command.clientProfile
    );

    const rawClientId =
      command.clientId?.trim() ||
      `${command.clientName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 28) || 'client'}-${crypto.randomBytes(3).toString('hex')}`;

    const clientId = ClientId.create(rawClientId);

    const existing = await this.clientRepository.findByClientId(clientId);
    if (existing) {
      const conflict = new DomainValidationError(
        `Client application "${clientId.getValue()}" already exists`
      );
      (conflict as Error & { statusCode?: number }).statusCode = 409;
      throw conflict;
    }

    const allowedOrigins = (command.allowedOrigins || []).map((o) => OriginDomain.create(o));
    const defaultGrantTypes =
      clientProfile === 'm2m'
        ? ['client_credentials']
        : clientType === 'confidential'
          ? ['authorization_code', 'refresh_token']
          : ['authorization_code', 'refresh_token'];

    const defaultScopes = clientProfile === 'm2m' ? ['identity:read'] : ['openid', 'profile'];

    let plainSecret: string | undefined;
    let clientSecretHash: string | null = null;
    if (clientType === 'confidential') {
      plainSecret = crypto.randomBytes(32).toString('base64url');
      clientSecretHash = await this.hashProvider.hash(plainSecret);
    }

    const client = ClientApplication.create({
      id: crypto.randomUUID(),
      tenantId,
      clientId,
      clientSecretHash,
      clientName: command.clientName,
      clientType,
      clientProfile,
      allowedOrigins,
      redirectUris: command.redirectUris ?? [],
      allowedGrantTypes:
        command.allowedGrantTypes && command.allowedGrantTypes.length > 0
          ? command.allowedGrantTypes
          : defaultGrantTypes,
      scopes: command.scopes && command.scopes.length > 0 ? command.scopes : defaultScopes,
      status: 'active',
    });

    await this.clientRepository.save(client);

    await this.auditLogger.logEvent({
      eventType: 'CLIENT_CREATED',
      severity: 'INFO',
      status: 'SUCCESS',
      tenantId,
      clientId: client.getClientId().getValue(),
      actor: command.actorUserId
        ? { userId: command.actorUserId, type: 'USER' }
        : { type: 'SYSTEM' },
      timestamp: new Date(),
      details: {
        clientProfile,
        clientType,
        scopes: client.getScopes(),
      },
    });

    const dto = toClientSafeViewDTO(client);
    return plainSecret ? { ...dto, clientSecret: plainSecret } : dto;
  }
}
