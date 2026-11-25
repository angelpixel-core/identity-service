import { UserKycVerification } from '../../../../domain/entities/kyc_verification/entity';
import { UserKycVerificationRepositoryPort } from '../../../../domain/ports/user_kyc_verification_repository_port';
import { TenantId } from '../../../../domain/value_objects/tenant_id/value';

export class InMemoryUserKycVerificationRepository implements UserKycVerificationRepositoryPort {
  private readonly items = new Map<string, UserKycVerification>();

  public async save(verification: UserKycVerification): Promise<void> {
    this.items.set(
      `${verification.getTenantId().getValue()}:${verification.getUserId()}`,
      verification
    );
  }

  public async findByUserAndTenant(
    userId: string,
    tenantId: TenantId
  ): Promise<UserKycVerification | null> {
    return this.items.get(`${tenantId.getValue()}:${userId}`) ?? null;
  }

  public async findByProviderRef(
    providerRef: string,
    tenantId: TenantId
  ): Promise<UserKycVerification | null> {
    const targetTenant = tenantId.getValue();
    for (const item of this.items.values()) {
      if (
        item.getTenantId().getValue() === targetTenant &&
        item.getProviderRef() === providerRef
      ) {
        return item;
      }
    }
    return null;
  }
}
