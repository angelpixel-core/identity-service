import {
  FederatedProviderProtocol,
  TenantFederatedProvider,
} from '../../../../domain/entities/tenant_federated_provider/entity';
import { TenantFederatedProviderRepositoryPort } from '../../../../domain/ports/repositories/tenant_federated_provider_repository_port';
import { TenantId } from '../../../../domain/value_objects/tenant_id/value';
import { DatabaseClient } from '../client_application/postgres_client_repository';

interface TenantFederatedProviderRow {
  id: string;
  tenant_id: string;
  provider_key: string;
  display_name: string;
  protocol: FederatedProviderProtocol;
  issuer_url: string;
  authorization_endpoint: string | null;
  token_endpoint: string | null;
  jwks_uri: string | null;
  client_id: string;
  encrypted_client_secret: string;
  scopes: string[];
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Secondary Adapter: PostgresTenantFederatedProviderRepository (US-33)
 */
export class PostgresTenantFederatedProviderRepository
  implements TenantFederatedProviderRepositoryPort
{
  constructor(private readonly db: DatabaseClient) {}

  public withClient(client: DatabaseClient): PostgresTenantFederatedProviderRepository {
    return new PostgresTenantFederatedProviderRepository(client);
  }

  private mapRow(row: TenantFederatedProviderRow): TenantFederatedProvider {
    return TenantFederatedProvider.reconstitute({
      id: row.id,
      tenantId: TenantId.create(row.tenant_id),
      providerKey: row.provider_key,
      displayName: row.display_name,
      protocol: row.protocol,
      issuerUrl: row.issuer_url,
      authorizationEndpoint: row.authorization_endpoint,
      tokenEndpoint: row.token_endpoint,
      jwksUri: row.jwks_uri,
      clientId: row.client_id,
      encryptedClientSecret: row.encrypted_client_secret,
      scopes: Array.isArray(row.scopes) ? row.scopes : ['openid', 'email', 'profile'],
      enabled: Boolean(row.enabled),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  }

  public async save(provider: TenantFederatedProvider): Promise<void> {
    const sql = `
      INSERT INTO tenant_federated_providers (
        id, tenant_id, provider_key, display_name, protocol,
        issuer_url, authorization_endpoint, token_endpoint, jwks_uri,
        client_id, encrypted_client_secret, scopes, enabled, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::text[], $13, $14, $15)
      ON CONFLICT (tenant_id, provider_key) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        protocol = EXCLUDED.protocol,
        issuer_url = EXCLUDED.issuer_url,
        authorization_endpoint = EXCLUDED.authorization_endpoint,
        token_endpoint = EXCLUDED.token_endpoint,
        jwks_uri = EXCLUDED.jwks_uri,
        client_id = EXCLUDED.client_id,
        encrypted_client_secret = EXCLUDED.encrypted_client_secret,
        scopes = EXCLUDED.scopes,
        enabled = EXCLUDED.enabled,
        updated_at = EXCLUDED.updated_at;
    `;
    await this.db.query(sql, [
      provider.getId(),
      provider.getTenantId().getValue(),
      provider.getProviderKey(),
      provider.getDisplayName(),
      provider.getProtocol(),
      provider.getIssuerUrl(),
      provider.getAuthorizationEndpoint(),
      provider.getTokenEndpoint(),
      provider.getJwksUri(),
      provider.getClientId(),
      provider.getEncryptedClientSecret(),
      [...provider.getScopes()],
      provider.isEnabled(),
      provider.getCreatedAt(),
      provider.getUpdatedAt(),
    ]);
  }

  public async findByTenantAndKey(
    tenantId: TenantId,
    providerKey: string
  ): Promise<TenantFederatedProvider | null> {
    const { rows } = await this.db.query<TenantFederatedProviderRow>(
      'SELECT * FROM tenant_federated_providers WHERE tenant_id = $1 AND provider_key = $2 LIMIT 1;',
      [tenantId.getValue(), providerKey.trim().toLowerCase()]
    );
    return rows?.[0] ? this.mapRow(rows[0]) : null;
  }

  public async listByTenant(tenantId: TenantId): Promise<readonly TenantFederatedProvider[]> {
    const { rows } = await this.db.query<TenantFederatedProviderRow>(
      'SELECT * FROM tenant_federated_providers WHERE tenant_id = $1 ORDER BY provider_key ASC;',
      [tenantId.getValue()]
    );
    return (rows ?? []).map((row) => this.mapRow(row));
  }

  public async deleteByTenantAndKey(tenantId: TenantId, providerKey: string): Promise<boolean> {
    const { rows } = await this.db.query<{ id: string }>(
      'DELETE FROM tenant_federated_providers WHERE tenant_id = $1 AND provider_key = $2 RETURNING id;',
      [tenantId.getValue(), providerKey.trim().toLowerCase()]
    );
    return Boolean(rows && rows.length > 0);
  }
}
