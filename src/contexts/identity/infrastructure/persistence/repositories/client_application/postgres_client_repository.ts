import { ClientApplicationRepositoryPort } from '../../../../domain/ports/client_application_repository_port';
import {
  ClientApplication,
  ClientProfile,
  ClientStatus,
  ClientType,
} from '../../../../domain/entities/client_application/aggregate';
import { ClientId } from '../../../../domain/value_objects/client_id/value';
import { OriginDomain } from '../../../../domain/value_objects/origin_domain/value';

export interface DatabaseClient {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
}

interface RegisteredClientRow {
  id: string;
  tenant_id?: string;
  client_id: string;
  client_secret_hash: string | null;
  previous_secret_hash?: string | null;
  secret_grace_expires_at?: Date | string | null;
  client_name: string;
  client_type: ClientType;
  client_profile?: ClientProfile;
  allowed_origins: string[];
  redirect_uris: string[];
  allowed_grant_types: string[];
  scopes: string[];
  is_active: boolean;
  status?: ClientStatus;
  created_at: Date;
  updated_at: Date;
}

/**
 * Secondary Adapter: PostgresClientApplicationRepository
 * Persiste y recupera clientes registrados en la tabla registered_clients de PostgreSQL.
 */
export class PostgresClientApplicationRepository implements ClientApplicationRepositoryPort {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * Crea una copia del repositorio vinculada a un DatabaseClient específico (e.g. una conexión transaccional con RLS).
   */
  public withClient(client: DatabaseClient): PostgresClientApplicationRepository {
    return new PostgresClientApplicationRepository(client);
  }

  public async save(client: ClientApplication): Promise<void> {
    const sql = `
      INSERT INTO registered_clients (
        id, tenant_id, client_id, client_secret_hash, previous_secret_hash, secret_grace_expires_at,
        client_name, client_type, client_profile,
        allowed_origins, redirect_uris, allowed_grant_types, scopes,
        is_active, status, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (id) DO UPDATE SET
        client_name = EXCLUDED.client_name,
        client_secret_hash = EXCLUDED.client_secret_hash,
        previous_secret_hash = EXCLUDED.previous_secret_hash,
        secret_grace_expires_at = EXCLUDED.secret_grace_expires_at,
        client_profile = EXCLUDED.client_profile,
        allowed_origins = EXCLUDED.allowed_origins,
        redirect_uris = EXCLUDED.redirect_uris,
        allowed_grant_types = EXCLUDED.allowed_grant_types,
        scopes = EXCLUDED.scopes,
        is_active = EXCLUDED.is_active,
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at;
    `;

    const params = [
      client.getId(),
      client.getTenantId(),
      client.getClientId().getValue(),
      client.getClientSecretHash(),
      client.getPreviousSecretHash(),
      client.getSecretGraceExpiresAt(),
      client.getClientName(),
      client.getClientType(),
      client.getClientProfile(),
      client.getAllowedOrigins().map((o) => o.getValue()),
      client.getRedirectUris(),
      client.getAllowedGrantTypes(),
      client.getScopes(),
      client.isActive(),
      client.getStatus(),
      client.getCreatedAt(),
      client.getUpdatedAt(),
    ];

    await this.db.query(sql, params);
  }

  private mapRowToDomain(row: RegisteredClientRow): ClientApplication {
    return ClientApplication.reconstitute({
      id: row.id,
      tenantId: row.tenant_id ?? 'acme-corp',
      clientId: ClientId.create(row.client_id),
      clientSecretHash: row.client_secret_hash,
      previousSecretHash: row.previous_secret_hash ?? null,
      secretGraceExpiresAt: row.secret_grace_expires_at
        ? new Date(row.secret_grace_expires_at)
        : null,
      clientName: row.client_name,
      clientType: row.client_type,
      clientProfile: row.client_profile,
      allowedOrigins: (row.allowed_origins || []).map((originStr) => OriginDomain.create(originStr)),
      redirectUris: row.redirect_uris || [],
      allowedGrantTypes: row.allowed_grant_types || [],
      scopes: row.scopes || [],
      isActive: row.is_active,
      status: row.status,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  }

  public async findByClientId(clientId: ClientId): Promise<ClientApplication | null> {
    const sql = `
      SELECT id, tenant_id, client_id, client_secret_hash, previous_secret_hash, secret_grace_expires_at,
             client_name, client_type, client_profile,
             allowed_origins, redirect_uris, allowed_grant_types, scopes,
             is_active, status, created_at, updated_at
      FROM registered_clients
      WHERE client_id = $1
      LIMIT 1;
    `;

    const { rows } = await this.db.query<RegisteredClientRow>(sql, [clientId.getValue()]);
    if (!rows || rows.length === 0 || !rows[0]) {
      return null;
    }

    return this.mapRowToDomain(rows[0]);
  }

  public async findByTenantId(tenantId: string): Promise<ClientApplication[]> {
    const sql = `
      SELECT id, tenant_id, client_id, client_secret_hash, previous_secret_hash, secret_grace_expires_at,
             client_name, client_type, client_profile,
             allowed_origins, redirect_uris, allowed_grant_types, scopes,
             is_active, status, created_at, updated_at
      FROM registered_clients
      WHERE tenant_id = $1
      ORDER BY client_id ASC;
    `;

    const { rows } = await this.db.query<RegisteredClientRow>(sql, [tenantId]);
    return (rows || []).map((row) => this.mapRowToDomain(row));
  }

  public async findAll(): Promise<ClientApplication[]> {
    const sql = `
      SELECT id, tenant_id, client_id, client_secret_hash, previous_secret_hash, secret_grace_expires_at,
             client_name, client_type, client_profile,
             allowed_origins, redirect_uris, allowed_grant_types, scopes,
             is_active, status, created_at, updated_at
      FROM registered_clients
      ORDER BY client_id ASC;
    `;

    const { rows } = await this.db.query<RegisteredClientRow>(sql);
    return (rows || []).map((row) => this.mapRowToDomain(row));
  }
}