import crypto from 'crypto';
import {
  ClientTenantBinding,
  normalizeCustomDomain,
} from '../../../domain/entities/client_tenant_binding/entity';
import { ClientTenantBindingRepositoryPort } from '../../../domain/ports/client_tenant_binding_repository_port';
import { ClientApplicationRepositoryPort } from '../../../domain/ports/client_application_repository_port';
import { ClientId } from '../../../domain/value_objects/client_id/value';
import { TenantId } from '../../../domain/value_objects/tenant_id/value';
import { DomainValidationError } from '../../../domain/exceptions/user/error';
import { OAuth2AuthenticationError } from '../../../domain/exceptions/oauth2/error';
import { SecurityAuditLoggerPort } from '../../ports/security/audit_logger';
import { InMemorySecurityAuditLogger } from '../../../infrastructure/logging/memory_security_audit_logger';
import { CacheProviderPort } from '../../ports/cache/cache_provider';
import { invalidateAuthConfigCacheForTenant } from '../../queries/get_public_auth_config/handler';

export interface ClientTenantBindingDTO {
  readonly id: string;
  readonly clientId: string;
  readonly tenantId: string;
  readonly customDomain: string | null;
  readonly allowedRedirectUris: string[];
  readonly allowedCorsOrigins: string[];
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toClientTenantBindingDTO(binding: ClientTenantBinding): ClientTenantBindingDTO {
  return {
    id: binding.getId(),
    clientId: binding.getClientId().getValue(),
    tenantId: binding.getTenantId().getValue(),
    customDomain: binding.getCustomDomain(),
    allowedRedirectUris: binding.getAllowedRedirectUris(),
    allowedCorsOrigins: binding.getAllowedCorsOrigins().map((o) => o.getValue()),
    isActive: binding.isActive(),
    createdAt: binding.getCreatedAt().toISOString(),
    updatedAt: binding.getUpdatedAt().toISOString(),
  };
}

export interface CreateClientTenantBindingCommand {
  readonly clientId: string;
  readonly tenantId: string;
  readonly callerTenantId: string;
  readonly isRootOperator?: boolean;
  readonly customDomain?: string | null;
  readonly allowedRedirectUris?: string[];
  readonly allowedCorsOrigins?: string[];
  readonly actorUserId?: string;
}

export interface UpdateClientTenantBindingCommand {
  readonly bindingId: string;
  readonly clientId: string;
  readonly callerTenantId: string;
  readonly isRootOperator?: boolean;
  readonly customDomain?: string | null;
  readonly allowedRedirectUris?: string[];
  readonly allowedCorsOrigins?: string[];
  readonly isActive?: boolean;
  readonly actorUserId?: string;
}

export interface RevokeClientTenantBindingCommand {
  readonly bindingId: string;
  readonly clientId: string;
  readonly callerTenantId: string;
  readonly isRootOperator?: boolean;
  readonly actorUserId?: string;
}

export class CreateClientTenantBindingCommandHandler {
  constructor(
    private readonly bindingRepository: ClientTenantBindingRepositoryPort,
    private readonly clientRepository: ClientApplicationRepositoryPort,
    private readonly auditLogger: SecurityAuditLoggerPort = new InMemorySecurityAuditLogger(),
    private readonly cacheProvider?: CacheProviderPort
  ) {}

  public async execute(cmd: CreateClientTenantBindingCommand): Promise<ClientTenantBindingDTO> {
    const clientId = ClientId.create(cmd.clientId);
    const tenantId = TenantId.create(cmd.tenantId);

    if (!cmd.isRootOperator && tenantId.getValue() !== cmd.callerTenantId) {
      throw new OAuth2AuthenticationError(
        'access_denied',
        `Forbidden: cannot bind client "${clientId.getValue()}" to another tenant "${tenantId.getValue()}"`,
        403
      );
    }

    const client = await this.clientRepository.findByClientId(clientId);
    if (!client) {
      const notFound = new DomainValidationError(
        `Client application "${clientId.getValue()}" was not found`
      );
      (notFound as Error & { statusCode?: number }).statusCode = 404;
      throw notFound;
    }

    const existingPair = await this.bindingRepository.findByClientAndTenant(clientId, tenantId);
    if (existingPair) {
      const conflict = new DomainValidationError(
        `Binding already exists for client "${clientId.getValue()}" and tenant "${tenantId.getValue()}"`
      );
      (conflict as Error & { statusCode?: number }).statusCode = 409;
      throw conflict;
    }

    const normalizedDomain = normalizeCustomDomain(cmd.customDomain);
    if (normalizedDomain) {
      const domainOwner = await this.bindingRepository.findByCustomDomain(normalizedDomain);
      if (domainOwner) {
        const conflict = new DomainValidationError(
          `Custom domain "${normalizedDomain}" is already bound to another tenant/client`
        );
        (conflict as Error & { statusCode?: number }).statusCode = 409;
        throw conflict;
      }
    }

    const binding = ClientTenantBinding.create({
      id: crypto.randomUUID(),
      clientId,
      tenantId,
      customDomain: normalizedDomain,
      allowedRedirectUris: cmd.allowedRedirectUris ?? [],
      allowedCorsOrigins: cmd.allowedCorsOrigins ?? [],
      isActive: true,
    });

    await this.bindingRepository.save(binding);
    await invalidateAuthConfigCacheForTenant(this.cacheProvider, binding.getTenantId().getValue());

    await this.auditLogger.logEvent({
      eventType: 'CLIENT_TENANT_BINDING_CREATED',
      severity: 'INFO',
      status: 'SUCCESS',
      tenantId: tenantId.getValue(),
      clientId: clientId.getValue(),
      actor: cmd.actorUserId
        ? { userId: cmd.actorUserId, type: cmd.isRootOperator ? 'OPERATOR' : 'USER' }
        : { type: 'SYSTEM' },
      timestamp: new Date(),
      details: {
        bindingId: binding.getId(),
        customDomain: binding.getCustomDomain(),
      },
    });

    return toClientTenantBindingDTO(binding);
  }
}

export class UpdateClientTenantBindingCommandHandler {
  constructor(
    private readonly bindingRepository: ClientTenantBindingRepositoryPort,
    private readonly auditLogger: SecurityAuditLoggerPort = new InMemorySecurityAuditLogger(),
    private readonly cacheProvider?: CacheProviderPort
  ) {}

  public async execute(cmd: UpdateClientTenantBindingCommand): Promise<ClientTenantBindingDTO> {
    const binding = await this.bindingRepository.findById(cmd.bindingId);
    if (!binding || binding.getClientId().getValue() !== cmd.clientId) {
      const notFound = new DomainValidationError(`Binding "${cmd.bindingId}" was not found`);
      (notFound as Error & { statusCode?: number }).statusCode = 404;
      throw notFound;
    }

    if (!cmd.isRootOperator && binding.getTenantId().getValue() !== cmd.callerTenantId) {
      throw new OAuth2AuthenticationError(
        'access_denied',
        'Forbidden: cannot modify binding belonging to another tenant',
        403
      );
    }

    if (cmd.customDomain !== undefined) {
      const normalized = normalizeCustomDomain(cmd.customDomain);
      if (normalized) {
        const owner = await this.bindingRepository.findByCustomDomain(normalized);
        if (owner && owner.getId() !== binding.getId()) {
          const conflict = new DomainValidationError(
            `Custom domain "${normalized}" is already bound to another tenant/client`
          );
          (conflict as Error & { statusCode?: number }).statusCode = 409;
          throw conflict;
        }
      }
    }

    binding.update({
      customDomain: cmd.customDomain,
      allowedRedirectUris: cmd.allowedRedirectUris,
      allowedCorsOrigins: cmd.allowedCorsOrigins,
      isActive: cmd.isActive,
    });

    await this.bindingRepository.save(binding);
    await invalidateAuthConfigCacheForTenant(this.cacheProvider, binding.getTenantId().getValue());

    await this.auditLogger.logEvent({
      eventType: 'CLIENT_TENANT_BINDING_UPDATED',
      severity: 'INFO',
      status: 'SUCCESS',
      tenantId: binding.getTenantId().getValue(),
      clientId: binding.getClientId().getValue(),
      actor: cmd.actorUserId
        ? { userId: cmd.actorUserId, type: cmd.isRootOperator ? 'OPERATOR' : 'USER' }
        : { type: 'SYSTEM' },
      timestamp: new Date(),
      details: {
        bindingId: binding.getId(),
        customDomain: binding.getCustomDomain(),
        isActive: binding.isActive(),
      },
    });

    return toClientTenantBindingDTO(binding);
  }
}

export class RevokeClientTenantBindingCommandHandler {
  constructor(
    private readonly bindingRepository: ClientTenantBindingRepositoryPort,
    private readonly auditLogger: SecurityAuditLoggerPort = new InMemorySecurityAuditLogger(),
    private readonly cacheProvider?: CacheProviderPort
  ) {}

  public async execute(cmd: RevokeClientTenantBindingCommand): Promise<void> {
    const binding = await this.bindingRepository.findById(cmd.bindingId);
    if (!binding || binding.getClientId().getValue() !== cmd.clientId) {
      const notFound = new DomainValidationError(`Binding "${cmd.bindingId}" was not found`);
      (notFound as Error & { statusCode?: number }).statusCode = 404;
      throw notFound;
    }

    if (!cmd.isRootOperator && binding.getTenantId().getValue() !== cmd.callerTenantId) {
      throw new OAuth2AuthenticationError(
        'access_denied',
        'Forbidden: cannot revoke binding belonging to another tenant',
        403
      );
    }

    await this.bindingRepository.deleteById(binding.getId());
    await invalidateAuthConfigCacheForTenant(this.cacheProvider, binding.getTenantId().getValue());

    await this.auditLogger.logEvent({
      eventType: 'CLIENT_TENANT_BINDING_REVOKED',
      severity: 'WARN',
      status: 'SUCCESS',
      tenantId: binding.getTenantId().getValue(),
      clientId: binding.getClientId().getValue(),
      actor: cmd.actorUserId
        ? { userId: cmd.actorUserId, type: cmd.isRootOperator ? 'OPERATOR' : 'USER' }
        : { type: 'SYSTEM' },
      timestamp: new Date(),
      details: {
        bindingId: binding.getId(),
      },
    });
  }
}
