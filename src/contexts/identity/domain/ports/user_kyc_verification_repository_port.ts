import { UserKycVerification } from '../entities/kyc_verification/entity';
import { TenantId } from '../value_objects/tenant_id/value';

/**
 * Secondary Port (SPI): UserKycVerificationRepositoryPort (US-37)
 */
export interface UserKycVerificationRepositoryPort {
  save(verification: UserKycVerification): Promise<void>;
  findByUserAndTenant(userId: string, tenantId: TenantId): Promise<UserKycVerification | null>;
  findByProviderRef(providerRef: string, tenantId: TenantId): Promise<UserKycVerification | null>;
}
