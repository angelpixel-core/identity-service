import { TenantFederatedProvider } from '../../../../domain/entities/tenant_federated_provider/entity';
import { TenantFederatedProviderRepositoryPort } from '../../../../domain/ports/repositories/tenant_federated_provider_repository_port';
import { TenantId } from '../../../../domain/value_objects/tenant_id/value';

/**
 * Secondary Adapter: InMemoryTenantFederatedProviderRepository (US-33)
 */
export class InMemoryTenantFederatedProviderRepository
  implements TenantFederatedProviderRepositoryPort
{
  private readonly store = new Map<string, TenantFederatedProvider>();

  private key(tenantId: TenantId, providerKey: string): string {
    return `${tenantId.getValue()}:${providerKey.trim().toLowerCase()}`;
  }

  public async save(provider: TenantFederatedProvider): Promise<void> {
    this.store.set(this.key(provider.getTenantId(), provider.getProviderKey()), provider);
  }

  public async findByTenantAndKey(
    tenantId: TenantId,
    providerKey: string
  ): Promise<TenantFederatedProvider | null> {
    return this.store.get(this.key(tenantId, providerKey)) ?? null;
  }

  public async listByTenant(tenantId: TenantId): Promise<readonly TenantFederatedProvider[]> {
    const tid = tenantId.getValue();
    return Array.from(this.store.values())
      .filter((p) => p.getTenantId().getValue() === tid)
      .sort((a, b) => a.getProviderKey().localeCompare(b.getProviderKey()));
  }

  public async deleteByTenantAndKey(tenantId: TenantId, providerKey: string): Promise<boolean> {
    return this.store.delete(this.key(tenantId, providerKey));
  }
}
