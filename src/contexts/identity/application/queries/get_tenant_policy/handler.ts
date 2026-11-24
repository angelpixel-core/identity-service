import {
  TenantAllowedAuthMethods,
  TenantKycPolicy,
  TenantPolicy,
  TenantRequiredAttributes,
} from '../../../domain/entities/tenant_policy/entity';
import { TenantPolicyRepositoryPort } from '../../../domain/ports/tenant_policy_repository_port';
import { TenantId } from '../../../domain/value_objects/tenant_id/value';
import { OAuth2AuthenticationError } from '../../../domain/exceptions/oauth2/error';

export interface TenantPolicyDTO {
  readonly tenantId: string;
  readonly requiredAttributes: TenantRequiredAttributes;
  readonly kycPolicy: TenantKycPolicy;
  readonly allowedAuthMethods: TenantAllowedAuthMethods;
  readonly updatedAt: string;
  readonly updatedBy: string;
  readonly isDefault: boolean;
}

export function toTenantPolicyDTO(policy: TenantPolicy, isDefault = false): TenantPolicyDTO {
  return {
    tenantId: policy.getTenantId().getValue(),
    requiredAttributes: policy.getRequiredAttributes(),
    kycPolicy: policy.getKycPolicy(),
    allowedAuthMethods: policy.getAllowedAuthMethods(),
    updatedAt: policy.getUpdatedAt().toISOString(),
    updatedBy: policy.getUpdatedBy(),
    isDefault,
  };
}

export interface GetTenantPolicyQuery {
  readonly targetTenantId: string;
  readonly callerTenantId: string;
  readonly isRootOperator?: boolean;
}

/**
 * Query Handler: GetTenantPolicy (US-30)
 */
export class GetTenantPolicyQueryHandler {
  constructor(private readonly policyRepository: TenantPolicyRepositoryPort) {}

  public async execute(query: GetTenantPolicyQuery): Promise<TenantPolicyDTO> {
    const targetTenant = TenantId.create(query.targetTenantId);

    if (!query.isRootOperator && targetTenant.getValue() !== query.callerTenantId) {
      throw new OAuth2AuthenticationError(
        'access_denied',
        `Forbidden: cannot read policy for tenant "${targetTenant.getValue()}"`,
        403
      );
    }

    const existing = await this.policyRepository.findByTenantId(targetTenant);
    if (!existing) {
      return toTenantPolicyDTO(TenantPolicy.defaultFor(targetTenant), true);
    }

    return toTenantPolicyDTO(existing, false);
  }
}
