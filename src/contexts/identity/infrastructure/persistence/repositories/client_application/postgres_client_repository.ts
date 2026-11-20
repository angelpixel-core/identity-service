import { ClientApplicationRepositoryPort } from '../../../../domain/ports/client_application_repository_port';
import { ClientApplication, ClientType } from '../../../../domain/entities/client_application/aggregate';
import { ClientId } from '../../../../domain/value_objects/client_id/value';
import { OriginDomain } from '../../../../domain/value_objects/origin_domain/value';

export interface DatabaseClient {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
}

interface RegisteredClientRow {
  id: string;
  client_id: string;
  client_secret_hash: string | null;
  client_name: string;
  client_type: ClientType;
  allowed_origins: string[];
  redirect_uris: string[];
  allowed_grant_types: string[];
  scopes: string[];
  is_active: boolean;
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
        id, client_id, client_secret_hash, client_name, client_type,
        allowed_origins, redirect_uris, allowed_grant_types, scopes,
        is_active, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (id) DO UPDATE SET
        client_name = EXCLUDED.client_name,
        client_secret_hash = EXCLUDED.client_secret_hash,
        allowed_origins = EXCLUDED.allowed_origins,
        redirect_uris = EXCLUDED.redirect_uris,
        allowed_grant_types = EXCLUDED.allowed_grant_types,
        scopes = EXCLUDED.scopes,
        is_active = EXCLUDED.is_active,
        updated_at = EXCLUDED.updated_at;
    `;

    const params = [
      client.getId(),
      client.getClientId().getValue(),
      client.getClientSecretHash(),
      client.getClientName(),
      client.getClientType(),
      client.getAllowedOrigins().map((o) => o.getValue()),
      client.getRedirectUris(),
      client.getAllowedGrantTypes(),
      client.getScopes(),
      client.isActive(),
      client.getCreatedAt(),
      client.getUpdatedAt(),
    ];

    await this.db.query(sql, params);
  }

  public async findByClientId(clientId: ClientId): Promise<ClientApplication | null> {
    const sql = `
      SELECT id, client_id, client_secret_hash, client_name, client_type,
             allowed_origins, redirect_uris, allowed_grant_types, scopes,
             is_active, created_at, updated_at
      FROM registered_clients
      WHERE client_id = $1
      LIMIT 1;
    `;

    const { rows } = await this.db.query<RegisteredClientRow>(sql, [clientId.getValue()]);
    if (!rows || rows.length === 0) {
      return null;
    }

    const row = rows[0];
    if (!row) {
      return null;
    }

    const allowedOrigins = (row.allowed_origins || []).map((originStr) => OriginDomain.create(originStr));

    return ClientApplication.reconstitute({
      id: row.id,
      clientId: ClientId.create(row.client_id),
      clientSecretHash: row.client_secret_hash,
      clientName: row.client_name,
      clientType: row.client_type,
      allowedOrigins,
      redirectUris: row.redirect_uris || [],
      allowedGrantTypes: row.allowed_grant_types || [],
      scopes: row.scopes || [],
      isActive: row.is_active,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  }

  public async findAll(): Promise<ClientApplication[]> {
    const sql = `
      SELECT id, client_id, client_secret_hash, client_name, client_type,
             allowed_origins, redirect_uris, allowed_grant_types, scopes,
             is_active, created_at, updated_at
      FROM registered_clients
      ORDER BY client_id ASC;
    `;

    const { rows } = await this.db.query<RegisteredClientRow>(sql);
    return (rows || []).map((row) =>
      ClientApplication.reconstitute({
        id: row.id,
        clientId: ClientId.create(row.client_id),
        clientSecretHash: row.client_secret_hash,
        clientName: row.client_name,
        clientType: row.client_type,
        allowedOrigins: (row.allowed_origins || []).map((originStr) => OriginDomain.create(originStr)),
        redirectUris: row.redirect_uris || [],
        allowedGrantTypes: row.allowed_grant_types || [],
        scopes: row.scopes || [],
        isActive: row.is_active,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      })
    );
  }
}