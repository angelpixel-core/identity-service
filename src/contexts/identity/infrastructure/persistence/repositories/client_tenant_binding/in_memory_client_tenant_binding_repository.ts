import { ClientTenantBindingRepositoryPort } from '../../../../domain/ports/client_tenant_binding_repository_port';
import {
  ClientTenantBinding,
  normalizeCustomDomain,
} from '../../../../domain/entities/client_tenant_binding/entity';
import { ClientId } from '../../../../domain/value_objects/client_id/value';
import { TenantId } from '../../../../domain/value_objects/tenant_id/value';

/**
 * In-Memory Adapter: InMemoryClientTenantBindingRepository (US-29)
 */
export class InMemoryClientTenantBindingRepository implements ClientTenantBindingRepositoryPort {
  private readonly bindings: Map<string, ClientTenantBinding> = new Map();

  public async save(binding: ClientTenantBinding): Promise<void> {
    this.bindings.set(binding.getId(), binding);
  }

  public async deleteById(id: string): Promise<void> {
    this.bindings.delete(id);
  }

  public async findById(id: string): Promise<ClientTenantBinding | null> {
    return this.bindings.get(id) ?? null;
  }

  public async findByClientId(clientId: ClientId): Promise<ClientTenantBinding[]> {
    const target = clientId.getValue();
    return Array.from(this.bindings.values()).filter((b) => b.getClientId().getValue() === target);
  }

  public async findByTenantId(tenantId: TenantId): Promise<ClientTenantBinding[]> {
    const target = tenantId.getValue();
    return Array.from(this.bindings.values()).filter((b) => b.getTenantId().getValue() === target);
  }

  public async findByClientAndTenant(
    clientId: ClientId,
    tenantId: TenantId
  ): Promise<ClientTenantBinding | null> {
    const c = clientId.getValue();
    const t = tenantId.getValue();
    return (
      Array.from(this.bindings.values()).find(
        (b) => b.getClientId().getValue() === c && b.getTenantId().getValue() === t
      ) ?? null
    );
  }

  public async findByClientAndDomain(
    clientId: ClientId,
    customDomain: string
  ): Promise<ClientTenantBinding | null> {
    const normalized = normalizeCustomDomain(customDomain);
    if (!normalized) return null;
    const c = clientId.getValue();
    return (
      Array.from(this.bindings.values()).find(
        (b) => b.getClientId().getValue() === c && b.getCustomDomain() === normalized
      ) ?? null
    );
  }

  public async findByCustomDomain(customDomain: string): Promise<ClientTenantBinding | null> {
    const normalized = normalizeCustomDomain(customDomain);
    if (!normalized) return null;
    return (
      Array.from(this.bindings.values()).find((b) => b.getCustomDomain() === normalized) ?? null
    );
  }

  public async findAll(): Promise<ClientTenantBinding[]> {
    return Array.from(this.bindings.values());
  }
}
