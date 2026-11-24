import { TenantPolicyRepositoryPort } from '../../../../domain/ports/tenant_policy_repository_port';
import {
  TenantAllowedAuthMethods,
  TenantKycPolicy,
  TenantPolicy,
  TenantRequiredAttributes,
} from '../../../../domain/entities/tenant_policy/entity';
import { TenantId } from '../../../../domain/value_objects/tenant_id/value';
import { DatabaseClient } from '../client_application/postgres_client_repository';

interface TenantPolicyRow {
  tenant_id: string;
  required_attributes: TenantRequiredAttributes;
  kyc_policy: TenantKycPolicy;
  allowed_auth_methods: TenantAllowedAuthMethods;
  updated_at: Date;
  updated_by: string;
}

/**
 * Secondary Adapter: PostgresTenantPolicyRepository (US-30)
 */
export class PostgresTenantPolicyRepository implements TenantPolicyRepositoryPort {
  constructor(private readonly db: DatabaseClient) {}

  public withClient(client: DatabaseClient): PostgresTenantPolicyRepository {
    return new PostgresTenantPolicyRepository(client);
  }

  private mapRow(row: TenantPolicyRow): TenantPolicy {
    return TenantPolicy.reconstitute({
      tenantId: TenantId.create(row.tenant_id),
      requiredAttributes: row.required_attributes,
      kycPolicy: row.kyc_policy,
      allowedAuthMethods: row.allowed_auth_methods,
      updatedAt: new Date(row.updated_at),
      updatedBy: row.updated_by,
    });
  }

  public async findByTenantId(tenantId: TenantId): Promise<TenantPolicy | null> {
    const { rows } = await this.db.query<TenantPolicyRow>(
      'SELECT * FROM tenant_policies WHERE tenant_id = $1 LIMIT 1;',
      [tenantId.getValue()]
    );
    return rows?.[0] ? this.mapRow(rows[0]) : null;
  }

  public async save(policy: TenantPolicy): Promise<void> {
    const sql = `
      INSERT INTO tenant_policies (
        tenant_id, required_attributes, kyc_policy, allowed_auth_methods, updated_at, updated_by
      )
      VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, $6)
      ON CONFLICT (tenant_id) DO UPDATE SET
        required_attributes = EXCLUDED.required_attributes,
        kyc_policy = EXCLUDED.kyc_policy,
        allowed_auth_methods = EXCLUDED.allowed_auth_methods,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by;
    `;
    await this.db.query(sql, [
      policy.getTenantId().getValue(),
      JSON.stringify(policy.getRequiredAttributes()),
      JSON.stringify(policy.getKycPolicy()),
      JSON.stringify(policy.getAllowedAuthMethods()),
      policy.getUpdatedAt(),
      policy.getUpdatedBy(),
    ]);
  }

  public async findAll(): Promise<TenantPolicy[]> {
    const { rows } = await this.db.query<TenantPolicyRow>(
      'SELECT * FROM tenant_policies ORDER BY tenant_id ASC;'
    );
    return (rows || []).map((r) => this.mapRow(r));
  }
}
