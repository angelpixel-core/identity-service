import { SafeTenantFederatedProviderDto } from '../../../domain/entities/tenant_federated_provider/entity';
import { OAuth2AuthenticationError } from '../../../domain/exceptions/oauth2/error';
import { TenantFederatedProviderRepositoryPort } from '../../../domain/ports/repositories/tenant_federated_provider_repository_port';
import { TenantId } from '../../../domain/value_objects/tenant_id/value';

export interface ListTenantFederatedProvidersQuery {
  readonly targetTenantId: string;
  readonly callerTenantId: string;
  readonly isRootOperator?: boolean;
}

/**
 * Query Handler: ListTenantFederatedProviders (US-33)
 */
export class ListTenantFederatedProvidersQueryHandler {
  constructor(private readonly repository: TenantFederatedProviderRepositoryPort) {}

  public async execute(
    query: ListTenantFederatedProvidersQuery
  ): Promise<readonly SafeTenantFederatedProviderDto[]> {
    const targetTenant = TenantId.create(query.targetTenantId);
    if (!query.isRootOperator && targetTenant.getValue() !== query.callerTenantId) {
      throw new OAuth2AuthenticationError(
        'access_denied',
        `Forbidden: cannot list federated providers for another tenant "${targetTenant.getValue()}"`,
        403
      );
    }

    const providers = await this.repository.listByTenant(targetTenant);
    return providers.map((p) => p.toSafeDto());
  }
}
