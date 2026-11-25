import {
  KycLevel,
  KycStatus,
  UserKycVerification,
} from '../../../../domain/entities/kyc_verification/entity';
import { UserKycVerificationRepositoryPort } from '../../../../domain/ports/user_kyc_verification_repository_port';
import { TenantId } from '../../../../domain/value_objects/tenant_id/value';
import { DatabaseClient } from '../user/repository';

interface UserKycVerificationRow {
  readonly id: string;
  readonly user_id: string;
  readonly tenant_id: string;
  readonly status: string;
  readonly level: string;
  readonly provider_ref: string | null;
  readonly verified_at: Date | string | null;
  readonly expires_at: Date | string | null;
  readonly updated_at: Date | string;
}

function mapRowToDomain(row: UserKycVerificationRow): UserKycVerification {
  return UserKycVerification.reconstitute({
    id: row.id,
    userId: row.user_id,
    tenantId: TenantId.create(row.tenant_id),
    status: row.status as KycStatus,
    level: row.level as KycLevel,
    providerRef: row.provider_ref,
    verifiedAt: row.verified_at ? new Date(row.verified_at) : null,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
  });
}

/**
 * Secondary Adapter: PostgresUserKycVerificationRepository (US-37)
 * Persiste estado KYC en user_kyc_verifications bajo RLS Fail-Closed.
 */
export class PostgresUserKycVerificationRepository implements UserKycVerificationRepositoryPort {
  constructor(private readonly db: DatabaseClient) {}

  public withClient(client: DatabaseClient): PostgresUserKycVerificationRepository {
    return new PostgresUserKycVerificationRepository(client);
  }

  public async save(verification: UserKycVerification): Promise<void> {
    const sql = `
      INSERT INTO user_kyc_verifications (
        id, user_id, tenant_id, status, level, provider_ref, verified_at, expires_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (user_id, tenant_id) DO UPDATE SET
        status = EXCLUDED.status,
        level = EXCLUDED.level,
        provider_ref = EXCLUDED.provider_ref,
        verified_at = EXCLUDED.verified_at,
        expires_at = EXCLUDED.expires_at,
        updated_at = EXCLUDED.updated_at;
    `;
    await this.db.query(sql, [
      verification.getId(),
      verification.getUserId(),
      verification.getTenantId().getValue(),
      verification.getStatus(),
      verification.getLevel(),
      verification.getProviderRef(),
      verification.getVerifiedAt(),
      verification.getExpiresAt(),
      verification.getUpdatedAt(),
    ]);
  }

  public async findByUserAndTenant(
    userId: string,
    tenantId: TenantId
  ): Promise<UserKycVerification | null> {
    const sql = `
      SELECT id, user_id, tenant_id, status, level, provider_ref, verified_at, expires_at, updated_at
      FROM user_kyc_verifications
      WHERE user_id = $1 AND tenant_id = $2
      LIMIT 1;
    `;
    const result = await this.db.query<UserKycVerificationRow>(sql, [
      userId,
      tenantId.getValue(),
    ]);
    const row = result.rows[0];
    return row ? mapRowToDomain(row) : null;
  }

  public async findByProviderRef(
    providerRef: string,
    tenantId: TenantId
  ): Promise<UserKycVerification | null> {
    const sql = `
      SELECT id, user_id, tenant_id, status, level, provider_ref, verified_at, expires_at, updated_at
      FROM user_kyc_verifications
      WHERE provider_ref = $1 AND tenant_id = $2
      LIMIT 1;
    `;
    const result = await this.db.query<UserKycVerificationRow>(sql, [
      providerRef,
      tenantId.getValue(),
    ]);
    const row = result.rows[0];
    return row ? mapRowToDomain(row) : null;
  }
}
