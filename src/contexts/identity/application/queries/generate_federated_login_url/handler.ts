import {
  ExternalIdentityProviderPort,
  FederatedProviderId,
} from '../../../domain/ports/external_identity_provider_port';
import { FederationStateManager } from '../../../infrastructure/federation/federation_state_manager';
import { TenantFederatedProviderResolver } from '../../services/tenant_federated_provider_resolver';
import { GenerateFederatedLoginUrlQuery } from './query';

export interface GenerateFederatedLoginUrlResult {
  url: string;
  state: string;
  nonce: string;
}

export class GenerateFederatedLoginUrlQueryHandler {
  private readonly providers: Map<FederatedProviderId, ExternalIdentityProviderPort>;
  private readonly stateManager: FederationStateManager;
  private readonly providerResolver?: TenantFederatedProviderResolver;

  constructor(
    providers: ExternalIdentityProviderPort[],
    stateManager: FederationStateManager,
    providerResolver?: TenantFederatedProviderResolver
  ) {
    this.providers = new Map(providers.map((p) => [p.providerId, p]));
    this.stateManager = stateManager;
    this.providerResolver = providerResolver;
  }

  public async execute(query: GenerateFederatedLoginUrlQuery): Promise<GenerateFederatedLoginUrlResult> {
    if (!query.provider) {
      throw new Error('Provider is required');
    }

    if (!query.tenantId || query.tenantId.trim() === '') {
      throw new Error('tenantId is required');
    }

    const adapter = this.providerResolver
      ? await this.providerResolver.resolve(query.tenantId, query.provider)
      : this.providers.get(query.provider);
    if (!adapter) {
      throw new Error(`Unsupported identity provider: "${query.provider}"`);
    }

    if (!query.redirectUri || query.redirectUri.trim() === '') {
      throw new Error('redirectUri is required');
    }

    const { state, nonce } = this.stateManager.generateState({
      tenantId: query.tenantId,
      clientId: query.clientId,
      redirectUri: query.redirectUri,
      provider: query.provider,
    });

    const url = await adapter.getAuthorizationUrl({
      tenantId: query.tenantId,
      clientId: query.clientId,
      redirectUri: query.redirectUri,
      state,
      nonce,
      prompt: query.prompt,
      loginHint: query.loginHint,
    });

    return {
      url,
      state,
      nonce,
    };
  }
}
