import { TenantFederatedProvider } from '../../entities/tenant_federated_provider/entity';
import { TenantId } from '../../value_objects/tenant_id/value';

/**
 * Puerto Secundario (SPI): Repositorio de Proveedores Federados por Tenant (US-33)
 */
export interface TenantFederatedProviderRepositoryPort {
  save(provider: TenantFederatedProvider): Promise<void>;
  findByTenantAndKey(
    tenantId: TenantId,
    providerKey: string
  ): Promise<TenantFederatedProvider | null>;
  listByTenant(tenantId: TenantId): Promise<readonly TenantFederatedProvider[]>;
  deleteByTenantAndKey(tenantId: TenantId, providerKey: string): Promise<boolean>;
}
