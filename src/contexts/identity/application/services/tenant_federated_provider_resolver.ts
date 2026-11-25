import {
  ExternalIdentityProviderPort,
  FederatedProviderId,
} from '../../domain/ports/external_identity_provider_port';
import { TenantFederatedProviderRepositoryPort } from '../../domain/ports/repositories/tenant_federated_provider_repository_port';
import { SecretCipherPort } from '../../domain/ports/security/secret_cipher_port';
import { TenantId } from '../../domain/value_objects/tenant_id/value';
import { GenericOidcAdapter } from '../../infrastructure/federation/generic_oidc_adapter';
import { HttpFetchFn } from '../../infrastructure/federation/jwks_token_verifier';

/**
 * Application Service: TenantFederatedProviderResolver (US-34)
 * Resuelve en runtime el adaptador OIDC/OAuth2 para (tenantId, providerKey):
 * 1. Busca primero en tenant_federated_providers (US-33), descifrando clientSecret en memoria.
 * 2. Si no existe override en el tenant, hace fallback a los adaptadores globales (US-10).
 */
export class TenantFederatedProviderResolver {
  private readonly globalAdapters = new Map<FederatedProviderId, ExternalIdentityProviderPort>();

  constructor(
    private readonly tenantProviderRepository: TenantFederatedProviderRepositoryPort,
    private readonly secretCipher: SecretCipherPort,
    globalProviders: readonly ExternalIdentityProviderPort[] = [],
    private readonly httpClient?: HttpFetchFn
  ) {
    for (const adapter of globalProviders) {
      this.globalAdapters.set(adapter.providerId, adapter);
    }
  }

  public async resolve(
    tenantId: string,
    providerKey: FederatedProviderId
  ): Promise<ExternalIdentityProviderPort | null> {
    const normalizedKey = providerKey.trim().toLowerCase();
    const tenantOverride = await this.tenantProviderRepository.findByTenantAndKey(
      TenantId.create(tenantId),
      normalizedKey
    );

    if (tenantOverride) {
      if (!tenantOverride.isEnabled()) {
        return null;
      }
      const decryptedSecret = this.secretCipher.decrypt(
        tenantOverride.getEncryptedClientSecret()
      );
      return new GenericOidcAdapter({
        providerId: tenantOverride.getProviderKey(),
        issuerUrl: tenantOverride.getIssuerUrl(),
        clientId: tenantOverride.getClientId(),
        clientSecret: decryptedSecret,
        scopes: tenantOverride.getScopes(),
        authorizationEndpoint: tenantOverride.getAuthorizationEndpoint(),
        tokenEndpoint: tenantOverride.getTokenEndpoint(),
        jwksUri: tenantOverride.getJwksUri(),
        httpClient: this.httpClient,
      });
    }

    return this.globalAdapters.get(normalizedKey) ?? null;
  }
}
