import { FederatedIdentity } from '../../../../domain/entities/federated_identity/aggregate';
import { FederatedProviderId } from '../../../../domain/ports/external_identity_provider_port';
import { TenantId } from '../../../../domain/value_objects/tenant_id/value';
import { FederatedIdentityRepositoryPort } from '../../../../domain/ports/repositories/federated_identity_repository_port';
import { DatabaseClient } from '../user/repository';
import { FederatedIdentityMapper } from '../../mappers/federated_identity/mapper';
import { FederatedIdentityDatabaseModel } from '../../models/federated_identity/model';

export class PostgresFederatedIdentityRepository implements FederatedIdentityRepositoryPort {
  constructor(private readonly db: DatabaseClient) { }

  public withClient(client: DatabaseClient): PostgresFederatedIdentityRepository {
    return new PostgresFederatedIdentityRepository(client);
  }

  public async save(federatedIdentity: FederatedIdentity): Promise<void> {
    const raw = FederatedIdentityMapper.toPersistence(federatedIdentity);
    const sql = `
      INSERT INTO federated_identities (
        id, user_id, tenant_id, provider, external_subject_id, external_email, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        external_email = EXCLUDED.external_email,
        updated_at = EXCLUDED.updated_at;
    `;
    const params = [
      raw.id,
      raw.user_id,
      raw.tenant_id,
      raw.provider,
      raw.external_subject_id,
      raw.external_email,
      raw.created_at,
      raw.updated_at,
    ];

    await this.db.query(sql, params);
  }

  public async findByProviderAndSubject(
    provider: FederatedProviderId,
    externalSubjectId: string
  ): Promise<FederatedIdentity | null> {
    const sql = `
      SELECT id, user_id, tenant_id, provider, external_subject_id, external_email, created_at, updated_at
      FROM federated_identities
      WHERE provider = $1 AND external_subject_id = $2
      LIMIT 1;
    `;
    const params = [provider, externalSubjectId];
    const result = await this.db.query<FederatedIdentityDatabaseModel>(sql, params);

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return FederatedIdentityMapper.toDomain(row);
  }

  public async findByUserIdAndProvider(
    userId: string,
    provider: FederatedProviderId,
    tenantId: TenantId
  ): Promise<FederatedIdentity | null> {
    const sql = `
      SELECT id, user_id, tenant_id, provider, external_subject_id, external_email, created_at, updated_at
      FROM federated_identities
      WHERE user_id = $1 AND provider = $2 AND tenant_id = $3
      LIMIT 1;
    `;
    const params = [userId, provider, tenantId.getValue()];
    const result = await this.db.query<FederatedIdentityDatabaseModel>(sql, params);

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return FederatedIdentityMapper.toDomain(row);
  }

  public async findAllByUserId(
    userId: string,
    tenantId: TenantId
  ): Promise<FederatedIdentity[]> {
    const sql = `
      SELECT id, user_id, tenant_id, provider, external_subject_id, external_email, created_at, updated_at
      FROM federated_identities
      WHERE user_id = $1 AND tenant_id = $2
      ORDER BY created_at ASC;
    `;
    const params = [userId, tenantId.getValue()];
    const result = await this.db.query<FederatedIdentityDatabaseModel>(sql, params);

    return result.rows.map((row) => FederatedIdentityMapper.toDomain(row));
  }
}
