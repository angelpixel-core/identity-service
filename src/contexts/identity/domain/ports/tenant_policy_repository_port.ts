import { TenantPolicy } from '../entities/tenant_policy/entity';
import { TenantId } from '../value_objects/tenant_id/value';

/**
 * Secondary Port: TenantPolicyRepositoryPort (US-30)
 */
export interface TenantPolicyRepositoryPort {
  findByTenantId(tenantId: TenantId): Promise<TenantPolicy | null>;
  save(policy: TenantPolicy): Promise<void>;
  findAll(): Promise<TenantPolicy[]>;
}
