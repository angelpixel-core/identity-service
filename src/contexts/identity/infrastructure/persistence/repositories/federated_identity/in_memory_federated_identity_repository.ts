import { FederatedIdentity } from '../../../../domain/entities/federated_identity/aggregate';
import { FederatedProviderId } from '../../../../domain/ports/external_identity_provider_port';
import { TenantId } from '../../../../domain/value_objects/tenant_id/value';
import { FederatedIdentityRepositoryPort } from '../../../../domain/ports/repositories/federated_identity_repository_port';

export class InMemoryFederatedIdentityRepository implements FederatedIdentityRepositoryPort {
  private readonly identities: Map<string, FederatedIdentity> = new Map();

  public async save(federatedIdentity: FederatedIdentity): Promise<void> {
    const key = `${federatedIdentity.getProvider()}:${federatedIdentity.getExternalSubjectId()}`;
    this.identities.set(key, federatedIdentity);
  }

  public async findByProviderAndSubject(
    provider: FederatedProviderId,
    externalSubjectId: string
  ): Promise<FederatedIdentity | null> {
    const key = `${provider}:${externalSubjectId}`;
    const found = this.identities.get(key);
    return found || null;
  }

  public async findByUserIdAndProvider(
    userId: string,
    provider: FederatedProviderId,
    tenantId: TenantId
  ): Promise<FederatedIdentity | null> {
    for (const identity of this.identities.values()) {
      if (
        identity.getUserId() === userId &&
        identity.getProvider() === provider &&
        identity.getTenantId().equals(tenantId)
      ) {
        return identity;
      }
    }
    return null;
  }

  public async findAllByUserId(
    userId: string,
    tenantId: TenantId
  ): Promise<FederatedIdentity[]> {
    const results: FederatedIdentity[] = [];
    for (const identity of this.identities.values()) {
      if (
        identity.getUserId() === userId &&
        identity.getTenantId().equals(tenantId)
      ) {
        results.push(identity);
      }
    }
    return results;
  }

  public clear(): void {
    this.identities.clear();
  }
}
