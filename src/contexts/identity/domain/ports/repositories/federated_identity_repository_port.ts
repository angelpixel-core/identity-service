import { FederatedIdentity } from '../../entities/federated_identity/aggregate';
import { FederatedProviderId } from '../external_identity_provider_port';
import { TenantId } from '../../value_objects/tenant_id/value';

/**
 * Secondary Port (SPI): FederatedIdentityRepositoryPort
 * Define las operaciones abstractas de persistencia para asociaciones de identidad federada.
 */
export interface FederatedIdentityRepositoryPort {
  save(federatedIdentity: FederatedIdentity): Promise<void>;
  findByProviderAndSubject(
    provider: FederatedProviderId,
    externalSubjectId: string
  ): Promise<FederatedIdentity | null>;
  findByUserIdAndProvider(
    userId: string,
    provider: FederatedProviderId,
    tenantId: TenantId
  ): Promise<FederatedIdentity | null>;
  findAllByUserId(
    userId: string,
    tenantId: TenantId
  ): Promise<FederatedIdentity[]>;
}
