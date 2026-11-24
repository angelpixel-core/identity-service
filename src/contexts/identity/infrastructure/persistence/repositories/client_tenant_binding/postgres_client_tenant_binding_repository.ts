import { ClientTenantBindingRepositoryPort } from '../../../../domain/ports/client_tenant_binding_repository_port';
import {
  ClientTenantBinding,
  normalizeCustomDomain,
} from '../../../../domain/entities/client_tenant_binding/entity';
import { ClientId } from '../../../../domain/value_objects/client_id/value';
import { TenantId } from '../../../../domain/value_objects/tenant_id/value';
import { OriginDomain } from '../../../../domain/value_objects/origin_domain/value';
import { DatabaseClient } from '../client_application/postgres_client_repository';

interface ClientTenantBindingRow {
  id: string;
  client_id: string;
  tenant_id: string;
  custom_domain: string | null;
  allowed_redirect_uris: string[];
  allowed_cors_origins: string[];
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Secondary Adapter: PostgresClientTenantBindingRepository (US-29)
 */
export class PostgresClientTenantBindingRepository implements ClientTenantBindingRepositoryPort {
  constructor(private readonly db: DatabaseClient) {}

  public withClient(client: DatabaseClient): PostgresClientTenantBindingRepository {
    return new PostgresClientTenantBindingRepository(client);
  }

  private mapRow(row: ClientTenantBindingRow): ClientTenantBinding {
    return ClientTenantBinding.reconstitute({
      id: row.id,
      clientId: ClientId.create(row.client_id),
      tenantId: TenantId.create(row.tenant_id),
      customDomain: row.custom_domain,
      allowedRedirectUris: row.allowed_redirect_uris || [],
      allowedCorsOrigins: (row.allowed_cors_origins || []).map((o) => OriginDomain.create(o)),
      isActive: row.is_active,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  }

  public async save(binding: ClientTenantBinding): Promise<void> {
    const sql = `
      INSERT INTO client_tenant_bindings (
        id, client_id, tenant_id, custom_domain,
        allowed_redirect_uris, allowed_cors_origins,
        is_active, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        custom_domain = EXCLUDED.custom_domain,
        allowed_redirect_uris = EXCLUDED.allowed_redirect_uris,
        allowed_cors_origins = EXCLUDED.allowed_cors_origins,
        is_active = EXCLUDED.is_active,
        updated_at = EXCLUDED.updated_at;
    `;
    await this.db.query(sql, [
      binding.getId(),
      binding.getClientId().getValue(),
      binding.getTenantId().getValue(),
      binding.getCustomDomain(),
      binding.getAllowedRedirectUris(),
      binding.getAllowedCorsOrigins().map((o) => o.getValue()),
      binding.isActive(),
      binding.getCreatedAt(),
      binding.getUpdatedAt(),
    ]);
  }

  public async deleteById(id: string): Promise<void> {
    await this.db.query('DELETE FROM client_tenant_bindings WHERE id = $1;', [id]);
  }

  public async findById(id: string): Promise<ClientTenantBinding | null> {
    const { rows } = await this.db.query<ClientTenantBindingRow>(
      'SELECT * FROM client_tenant_bindings WHERE id = $1 LIMIT 1;',
      [id]
    );
    return rows?.[0] ? this.mapRow(rows[0]) : null;
  }

  public async findByClientId(clientId: ClientId): Promise<ClientTenantBinding[]> {
    const { rows } = await this.db.query<ClientTenantBindingRow>(
      'SELECT * FROM client_tenant_bindings WHERE client_id = $1 ORDER BY created_at ASC;',
      [clientId.getValue()]
    );
    return (rows || []).map((r) => this.mapRow(r));
  }

  public async findByTenantId(tenantId: TenantId): Promise<ClientTenantBinding[]> {
    const { rows } = await this.db.query<ClientTenantBindingRow>(
      'SELECT * FROM client_tenant_bindings WHERE tenant_id = $1 ORDER BY created_at ASC;',
      [tenantId.getValue()]
    );
    return (rows || []).map((r) => this.mapRow(r));
  }

  public async findByClientAndTenant(
    clientId: ClientId,
    tenantId: TenantId
  ): Promise<ClientTenantBinding | null> {
    const { rows } = await this.db.query<ClientTenantBindingRow>(
      'SELECT * FROM client_tenant_bindings WHERE client_id = $1 AND tenant_id = $2 LIMIT 1;',
      [clientId.getValue(), tenantId.getValue()]
    );
    return rows?.[0] ? this.mapRow(rows[0]) : null;
  }

  public async findByClientAndDomain(
    clientId: ClientId,
    customDomain: string
  ): Promise<ClientTenantBinding | null> {
    const normalized = normalizeCustomDomain(customDomain);
    if (!normalized) return null;
    const { rows } = await this.db.query<ClientTenantBindingRow>(
      'SELECT * FROM client_tenant_bindings WHERE client_id = $1 AND custom_domain = $2 LIMIT 1;',
      [clientId.getValue(), normalized]
    );
    return rows?.[0] ? this.mapRow(rows[0]) : null;
  }

  public async findByCustomDomain(customDomain: string): Promise<ClientTenantBinding | null> {
    const normalized = normalizeCustomDomain(customDomain);
    if (!normalized) return null;
    const { rows } = await this.db.query<ClientTenantBindingRow>(
      'SELECT * FROM client_tenant_bindings WHERE custom_domain = $1 LIMIT 1;',
      [normalized]
    );
    return rows?.[0] ? this.mapRow(rows[0]) : null;
  }

  public async findAll(): Promise<ClientTenantBinding[]> {
    const { rows } = await this.db.query<ClientTenantBindingRow>(
      'SELECT * FROM client_tenant_bindings ORDER BY created_at ASC;'
    );
    return (rows || []).map((r) => this.mapRow(r));
  }
}
