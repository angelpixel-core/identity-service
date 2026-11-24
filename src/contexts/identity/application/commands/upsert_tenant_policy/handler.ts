import {
  KycMinLevel,
  TenantAllowedAuthMethods,
  TenantKycPolicy,
  TenantPolicy,
  TenantRequiredAttributes,
} from '../../../domain/entities/tenant_policy/entity';
import { TenantPolicyRepositoryPort } from '../../../domain/ports/tenant_policy_repository_port';
import { TenantId } from '../../../domain/value_objects/tenant_id/value';
import { OAuth2AuthenticationError } from '../../../domain/exceptions/oauth2/error';
import { SecurityAuditLoggerPort } from '../../ports/security/audit_logger';
import { InMemorySecurityAuditLogger } from '../../../infrastructure/logging/memory_security_audit_logger';
import { TenantPolicyDTO, toTenantPolicyDTO } from '../../queries/get_tenant_policy/handler';
import { CacheProviderPort } from '../../ports/cache/cache_provider';
import { invalidateAuthConfigCacheForTenant } from '../../queries/get_public_auth_config/handler';

export interface UpsertTenantPolicyCommand {
  readonly targetTenantId: string;
  readonly callerTenantId: string;
  readonly callerRoles?: readonly string[];
  readonly isRootOperator?: boolean;
  readonly actorId: string;
  readonly requiredAttributes?: Partial<TenantRequiredAttributes>;
  readonly kycPolicy?: Partial<TenantKycPolicy> & { minLevel?: KycMinLevel };
  readonly allowedAuthMethods?: Partial<TenantAllowedAuthMethods>;
}

/**
 * Command Handler: UpsertTenantPolicy (US-30)
 * Solo system:superadmin o tenant_admin/admin del propio tenant pueden mutar la política.
 */
export class UpsertTenantPolicyCommandHandler {
  constructor(
    private readonly policyRepository: TenantPolicyRepositoryPort,
    private readonly auditLogger: SecurityAuditLoggerPort = new InMemorySecurityAuditLogger(),
    private readonly cacheProvider?: CacheProviderPort
  ) {}

  public async execute(cmd: UpsertTenantPolicyCommand): Promise<TenantPolicyDTO> {
    const targetTenant = TenantId.create(cmd.targetTenantId);
    const roles = cmd.callerRoles ?? [];
    const isTenantAdmin =
      targetTenant.getValue() === cmd.callerTenantId &&
      (roles.includes('tenant_admin') || roles.includes('admin'));

    if (!cmd.isRootOperator && !isTenantAdmin) {
      throw new OAuth2AuthenticationError(
        'access_denied',
        `Forbidden: tenant_admin or system:superadmin role required to modify policy for "${targetTenant.getValue()}"`,
        403
      );
    }

    const existing = await this.policyRepository.findByTenantId(targetTenant);
    const beforeSnapshot = existing
      ? toTenantPolicyDTO(existing, false)
      : toTenantPolicyDTO(TenantPolicy.defaultFor(targetTenant), true);

    const policy = existing
      ? existing
      : TenantPolicy.create({
          tenantId: targetTenant,
          requiredAttributes: cmd.requiredAttributes,
          kycPolicy: cmd.kycPolicy,
          allowedAuthMethods: cmd.allowedAuthMethods,
          updatedBy: cmd.actorId,
        });

    if (existing) {
      policy.update({
        requiredAttributes: cmd.requiredAttributes,
        kycPolicy: cmd.kycPolicy,
        allowedAuthMethods: cmd.allowedAuthMethods,
        updatedBy: cmd.actorId,
      });
    }

    await this.policyRepository.save(policy);
    await invalidateAuthConfigCacheForTenant(this.cacheProvider, targetTenant.getValue());
    const afterSnapshot = toTenantPolicyDTO(policy, false);

    await this.auditLogger.logEvent({
      eventType: 'TENANT_POLICY_UPDATED',
      severity: 'INFO',
      status: 'SUCCESS',
      tenantId: targetTenant.getValue(),
      actor: {
        userId: cmd.actorId,
        type: cmd.isRootOperator ? 'OPERATOR' : 'USER',
      },
      timestamp: new Date(),
      details: {
        before: {
          requiredAttributes: beforeSnapshot.requiredAttributes,
          kycPolicy: beforeSnapshot.kycPolicy,
          allowedAuthMethods: beforeSnapshot.allowedAuthMethods,
        },
        after: {
          requiredAttributes: afterSnapshot.requiredAttributes,
          kycPolicy: afterSnapshot.kycPolicy,
          allowedAuthMethods: afterSnapshot.allowedAuthMethods,
        },
      },
    });

    if (cmd.isRootOperator && targetTenant.getValue() !== 'system') {
      await this.auditLogger.logEvent({
        eventType: 'PLATFORM_OPERATOR_CROSS_TENANT_ACTION',
        severity: 'INFO',
        status: 'GRANTED_ELEVATED',
        tenantId: targetTenant.getValue(),
        actor: { userId: cmd.actorId, type: 'OPERATOR' },
        timestamp: new Date(),
        details: {
          action: 'UPSERT_TENANT_POLICY',
          targetTenantId: targetTenant.getValue(),
        },
      });
    }

    return afterSnapshot;
  }
}
