import { TenantPolicyRepositoryPort } from '../../../../domain/ports/tenant_policy_repository_port';
import { TenantPolicy } from '../../../../domain/entities/tenant_policy/entity';
import { TenantId } from '../../../../domain/value_objects/tenant_id/value';

/**
 * In-Memory Adapter: InMemoryTenantPolicyRepository (US-30)
 */
export class InMemoryTenantPolicyRepository implements TenantPolicyRepositoryPort {
  private readonly policies: Map<string, TenantPolicy> = new Map();

  public async findByTenantId(tenantId: TenantId): Promise<TenantPolicy | null> {
    return this.policies.get(tenantId.getValue()) ?? null;
  }

  public async save(policy: TenantPolicy): Promise<void> {
    this.policies.set(policy.getTenantId().getValue(), policy);
  }

  public async findAll(): Promise<TenantPolicy[]> {
    return Array.from(this.policies.values()).sort((a, b) =>
      a.getTenantId().getValue().localeCompare(b.getTenantId().getValue())
    );
  }
}
