import { normalizeProviderKey } from '../../../domain/entities/tenant_federated_provider/entity';
import { TenantFederatedProviderRepositoryPort } from '../../../domain/ports/repositories/tenant_federated_provider_repository_port';
import { TenantId } from '../../../domain/value_objects/tenant_id/value';
import { InMemorySecurityAuditLogger } from '../../../infrastructure/logging/memory_security_audit_logger';
import { CacheProviderPort } from '../../ports/cache/cache_provider';
import { SecurityAuditLoggerPort } from '../../ports/security/audit_logger';
import { invalidateAuthConfigCacheForTenant } from '../../queries/get_public_auth_config/handler';
import { assertCanManageTenantFederation } from '../register_tenant_federated_provider/handler';

export interface RemoveTenantFederatedProviderCommand {
  readonly targetTenantId: string;
  readonly callerTenantId: string;
  readonly callerRoles?: readonly string[];
  readonly isRootOperator?: boolean;
  readonly actorId: string;
  readonly providerKey: string;
}

export interface RemoveTenantFederatedProviderResult {
  readonly removed: boolean;
  readonly providerKey: string;
}

/**
 * Command Handler: RemoveTenantFederatedProvider (US-33)
 */
export class RemoveTenantFederatedProviderCommandHandler {
  constructor(
    private readonly repository: TenantFederatedProviderRepositoryPort,
    private readonly auditLogger: SecurityAuditLoggerPort = new InMemorySecurityAuditLogger(),
    private readonly cacheProvider?: CacheProviderPort
  ) {}

  public async execute(
    cmd: RemoveTenantFederatedProviderCommand
  ): Promise<RemoveTenantFederatedProviderResult> {
    const targetTenant = TenantId.create(cmd.targetTenantId);
    assertCanManageTenantFederation({
      targetTenantId: targetTenant.getValue(),
      callerTenantId: cmd.callerTenantId,
      callerRoles: cmd.callerRoles,
      isRootOperator: cmd.isRootOperator,
    });

    const providerKey = normalizeProviderKey(cmd.providerKey);
    const removed = await this.repository.deleteByTenantAndKey(targetTenant, providerKey);

    if (removed) {
      await invalidateAuthConfigCacheForTenant(this.cacheProvider, targetTenant.getValue());

      await this.auditLogger.logEvent({
        eventType: 'TENANT_IDP_REMOVED',
        severity: 'INFO',
        status: 'SUCCESS',
        tenantId: targetTenant.getValue(),
        actor: {
          userId: cmd.actorId,
          type: cmd.isRootOperator ? 'OPERATOR' : 'USER',
        },
        timestamp: new Date(),
        details: {
          providerKey,
          clientSecret: '[REDACTED]',
        },
      });

      if (cmd.isRootOperator && cmd.callerTenantId !== targetTenant.getValue()) {
        await this.auditLogger.logEvent({
          eventType: 'PLATFORM_OPERATOR_CROSS_TENANT_ACTION',
          severity: 'WARN',
          status: 'SUCCESS',
          tenantId: targetTenant.getValue(),
          actor: { userId: cmd.actorId, type: 'OPERATOR' },
          timestamp: new Date(),
          details: {
            action: 'REMOVE_TENANT_FEDERATED_PROVIDER',
            targetTenantId: targetTenant.getValue(),
            providerKey,
          },
        });
      }
    }

    return { removed, providerKey };
  }
}
