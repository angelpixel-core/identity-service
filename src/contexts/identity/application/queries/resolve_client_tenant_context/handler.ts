import { ClientTenantBindingRepositoryPort } from '../../../domain/ports/client_tenant_binding_repository_port';
import { ClientApplicationRepositoryPort } from '../../../domain/ports/client_application_repository_port';
import { ClientId } from '../../../domain/value_objects/client_id/value';
import { TenantId } from '../../../domain/value_objects/tenant_id/value';
import { ClientTenantBinding } from '../../../domain/entities/client_tenant_binding/entity';
import { OAuth2AuthenticationError } from '../../../domain/exceptions/oauth2/error';
import { SecurityAuditLoggerPort } from '../../ports/security/audit_logger';
import { InMemorySecurityAuditLogger } from '../../../infrastructure/logging/memory_security_audit_logger';

export interface ResolveClientTenantContextQuery {
  readonly clientId: string;
  readonly tenantId?: string;
  readonly domain?: string;
  readonly redirectUri?: string;
  readonly origin?: string;
  readonly ip?: string;
}

export interface ResolvedClientTenantContextDTO {
  readonly bindingId: string;
  readonly clientId: string;
  readonly tenantId: string;
  readonly customDomain: string | null;
  readonly allowedRedirectUris: string[];
  readonly allowedCorsOrigins: string[];
}

/**
 * Query Handler: ResolveClientTenantContext (US-29)
 * Resuelve de forma explícita y fail-closed la combinación (client_id, tenant_id | domain)
 * contra client_tenant_bindings, validando redirect_uri y Origin.
 */
export class ResolveClientTenantContextQueryHandler {
  constructor(
    private readonly bindingRepository: ClientTenantBindingRepositoryPort,
    private readonly clientRepository: ClientApplicationRepositoryPort,
    private readonly auditLogger: SecurityAuditLoggerPort = new InMemorySecurityAuditLogger()
  ) {}

  private async logViolation(
    query: ResolveClientTenantContextQuery,
    reason: string
  ): Promise<void> {
    await this.auditLogger.logEvent({
      eventType: 'CLIENT_TENANT_BINDING_VIOLATION',
      severity: 'ALERT',
      status: 'DENIED',
      tenantId: query.tenantId,
      clientId: query.clientId,
      ip: query.ip,
      timestamp: new Date(),
      reason,
      details: {
        domain: query.domain ?? null,
        redirectUri: query.redirectUri ?? null,
        origin: query.origin ?? null,
      },
    });
  }

  public async execute(
    query: ResolveClientTenantContextQuery
  ): Promise<ResolvedClientTenantContextDTO> {
    if (!query.clientId || !query.clientId.trim()) {
      throw new OAuth2AuthenticationError('invalid_request', 'Missing client_id parameter', 400);
    }

    let clientId: ClientId;
    try {
      clientId = ClientId.create(query.clientId);
    } catch {
      throw new OAuth2AuthenticationError('invalid_client', 'Invalid client_id format', 400);
    }

    const hasExplicitTenant = Boolean(query.tenantId && query.tenantId.trim());
    const hasExplicitDomain = Boolean(query.domain && query.domain.trim());
    if (!hasExplicitTenant && !hasExplicitDomain) {
      await this.logViolation(query, 'Missing explicit tenant_id or domain');
      throw new OAuth2AuthenticationError(
        'forbidden_tenant_client_binding',
        'Explicit tenant_id or domain is required to resolve client binding',
        403
      );
    }

    const client = await this.clientRepository.findByClientId(clientId);
    if (!client || !client.isActive()) {
      await this.logViolation(query, 'Client application not found or suspended');
      throw new OAuth2AuthenticationError(
        'forbidden_tenant_client_binding',
        `Client "${clientId.getValue()}" is missing or suspended`,
        403
      );
    }

    let binding: ClientTenantBinding | null = null;
    if (hasExplicitTenant) {
      let tenantId: TenantId;
      try {
        tenantId = TenantId.create(query.tenantId!);
      } catch {
        await this.logViolation(query, 'Invalid tenant_id format');
        throw new OAuth2AuthenticationError(
          'forbidden_tenant_client_binding',
          'Invalid tenant_id format',
          403
        );
      }
      binding = await this.bindingRepository.findByClientAndTenant(clientId, tenantId);
      if (binding && hasExplicitDomain) {
        const domainBinding = await this.bindingRepository.findByClientAndDomain(
          clientId,
          query.domain!
        );
        if (!domainBinding || domainBinding.getId() !== binding.getId()) {
          await this.logViolation(query, 'tenant_id and domain do not match the same binding');
          throw new OAuth2AuthenticationError(
            'forbidden_tenant_client_binding',
            'Mismatch between tenant_id and domain binding',
            403
          );
        }
      }
    } else if (hasExplicitDomain) {
      binding = await this.bindingRepository.findByClientAndDomain(clientId, query.domain!);
    }

    if (!binding || !binding.isActive()) {
      await this.logViolation(query, 'No active client-tenant binding found');
      throw new OAuth2AuthenticationError(
        'forbidden_tenant_client_binding',
        `Client "${clientId.getValue()}" is not bound to the requested tenant/domain`,
        403
      );
    }

    if (query.redirectUri && query.redirectUri.trim()) {
      if (!binding.matchesRedirectUri(query.redirectUri)) {
        await this.logViolation(query, `redirect_uri "${query.redirectUri}" not in binding allowlist`);
        throw new OAuth2AuthenticationError(
          'invalid_redirect_uri',
          `redirect_uri "${query.redirectUri}" is not authorized for this client-tenant binding`,
          400
        );
      }
    }

    if (query.origin && query.origin.trim()) {
      if (!binding.matchesCorsOrigin(query.origin)) {
        await this.logViolation(query, `Origin "${query.origin}" not in binding CORS allowlist`);
        throw new OAuth2AuthenticationError(
          'forbidden_tenant_client_binding',
          `Origin "${query.origin}" is not authorized for this client-tenant binding`,
          403
        );
      }
    }

    return {
      bindingId: binding.getId(),
      clientId: binding.getClientId().getValue(),
      tenantId: binding.getTenantId().getValue(),
      customDomain: binding.getCustomDomain(),
      allowedRedirectUris: binding.getAllowedRedirectUris(),
      allowedCorsOrigins: binding.getAllowedCorsOrigins().map((o) => o.getValue()),
    };
  }
}
