import { ClientTenantBinding } from '../entities/client_tenant_binding/entity';
import { ClientId } from '../value_objects/client_id/value';
import { TenantId } from '../value_objects/tenant_id/value';

/**
 * Secondary Port: ClientTenantBindingRepositoryPort (US-29)
 * Gestiona las vinculaciones N:M entre aplicaciones cliente, inquilinos y dominios custom.
 */
export interface ClientTenantBindingRepositoryPort {
  save(binding: ClientTenantBinding): Promise<void>;
  deleteById(id: string): Promise<void>;
  findById(id: string): Promise<ClientTenantBinding | null>;
  findByClientId(clientId: ClientId): Promise<ClientTenantBinding[]>;
  findByTenantId(tenantId: TenantId): Promise<ClientTenantBinding[]>;
  findByClientAndTenant(clientId: ClientId, tenantId: TenantId): Promise<ClientTenantBinding | null>;
  findByClientAndDomain(clientId: ClientId, customDomain: string): Promise<ClientTenantBinding | null>;
  findByCustomDomain(customDomain: string): Promise<ClientTenantBinding | null>;
  findAll(): Promise<ClientTenantBinding[]>;
}
