import { ExternalIdentityProviderPort } from '../../../domain/ports/external_identity_provider_port';

export interface FederatedProviderSummary {
  readonly id: string;
  readonly displayName: string;
  readonly protocol: 'oidc';
}

/**
 * Secondary Port (SPI): TenantFederatedProvidersPort (US-31 / US-33)
 * Proyecta de forma segura (sin secretos) los proveedores OIDC habilitados para un tenant.
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
