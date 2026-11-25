import { ExternalIdentityProviderPort } from '../../../domain/ports/external_identity_provider_port';
import { TenantFederatedProviderRepositoryPort } from '../../../domain/ports/repositories/tenant_federated_provider_repository_port';
import { TenantId } from '../../../domain/value_objects/tenant_id/value';

export interface FederatedProviderSummary {
  readonly id: string;
  readonly displayName: string;
  readonly protocol: 'oidc' | 'oauth2';
}

/**
 * Secondary Port (SPI): TenantFederatedProvidersPort (US-31 / US-33)
 * Proyecta de forma segura (sin secretos) los proveedores OIDC/OAuth2 habilitados para un tenant.
 */
export interface TenantFederatedProvidersPort {
  listForTenant(tenantId: string): Promise<readonly FederatedProviderSummary[]>;
}

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  google: 'Google',
  microsoft: 'Microsoft',
};

/**
 * Adaptador por defecto (US-31): proyecta los adaptadores federados activos del servidor
 * sin exponer clientId, clientSecret ni endpoints internos.
 */
export class DefaultTenantFederatedProvidersAdapter implements TenantFederatedProvidersPort {
  private readonly summaries: readonly FederatedProviderSummary[];

  constructor(providers: readonly ExternalIdentityProviderPort[]) {
    this.summaries = providers.map((p) => ({
      id: p.providerId,
      displayName: PROVIDER_DISPLAY_NAMES[p.providerId] ?? p.providerId,
      protocol: 'oidc',
    }));
  }

  public async listForTenant(_tenantId: string): Promise<readonly FederatedProviderSummary[]> {
    return this.summaries;
  }
}

/**
 * Adaptador compuesto (US-33): combina los proveedores globales por defecto con los
 * proveedores OIDC/OAuth2 habilitados del inquilino sin exponer clientId ni secretos.
 */
export class CompositeTenantFederatedProvidersAdapter implements TenantFederatedProvidersPort {
  private readonly defaultAdapter: DefaultTenantFederatedProvidersAdapter;

  constructor(
    defaultProviders: readonly ExternalIdentityProviderPort[],
    private readonly tenantProviderRepository: TenantFederatedProviderRepositoryPort
  ) {
    this.defaultAdapter = new DefaultTenantFederatedProvidersAdapter(defaultProviders);
  }

  public async listForTenant(tenantId: string): Promise<readonly FederatedProviderSummary[]> {
    const base = await this.defaultAdapter.listForTenant(tenantId);
    const tenantProviders = await this.tenantProviderRepository.listByTenant(
      TenantId.create(tenantId)
    );

    const byId = new Map<string, FederatedProviderSummary>();
    for (const item of base) {
      byId.set(item.id, item);
    }
    for (const provider of tenantProviders) {
      if (!provider.isEnabled()) {
        byId.delete(provider.getProviderKey());
        continue;
      }
      byId.set(provider.getProviderKey(), {
        id: provider.getProviderKey(),
        displayName: provider.getDisplayName(),
        protocol: provider.getProtocol(),
      });
    }

    return Array.from(byId.values());
  }
}
