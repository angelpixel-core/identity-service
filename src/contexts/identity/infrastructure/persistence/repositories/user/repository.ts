import { UserRepositoryPort } from '../../../../application/ports/user/repository';
import { User } from '../../../../domain/entities/user/aggregate';
import { Email } from '../../../../domain/value_objects/email/value';
import { TenantId } from '../../../../domain/value_objects/tenant_id/value';
import { UserMapper } from '../../mappers/user/mapper';
import { UserDatabaseModel } from '../../models/user/model';

/**
 * Interfaz genérica para clientes de base de datos relacionales (pg.Pool, pg.Client).
 */
export interface DatabaseClient {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount?: number | null }>;
}

/**
 * Secondary Adapter: PostgresUserRepository
 * Implementación de UserRepositoryPort sobre PostgreSQL con aislamiento multi-tenant estricto.
 */
export class PostgresUserRepository implements UserRepositoryPort {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * Crea una copia del repositorio vinculada a un DatabaseClient específico (e.g. una conexión transaccional con RLS).
   */
  public withClient(client: DatabaseClient): PostgresUserRepository {
    return new PostgresUserRepository(client);
  }

  /**
   * Persiste o actualiza un agregado User en la base de datos PostgreSQL.
   */
  public async save(user: User): Promise<void> {
    const raw = UserMapper.toPersistence(user);
    const sql = `
      INSERT INTO users (id, email, password_hash, tenant_id, roles, phone, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        password_hash = EXCLUDED.password_hash,
        roles = EXCLUDED.roles,
        phone = EXCLUDED.phone,
        updated_at = EXCLUDED.updated_at;
    `;
    const params = [
      raw.id,
      raw.email,
      raw.password_hash,
      raw.tenant_id,
      raw.roles,
      raw.phone ?? null,
      raw.created_at,
      raw.updated_at,
    ];

    await this.db.query(sql, params);
  }

  /**
   * Busca un usuario por email y tenant_id, garantizando aislamiento entre organizaciones.
   */
  public async findByEmail(email: Email, tenantId: TenantId): Promise<User | null> {
    const sql = `
      SELECT id, email, password_hash, tenant_id, roles, phone, created_at, updated_at
      FROM users
      WHERE email = $1 AND tenant_id = $2
      LIMIT 1;
    `;
    const params = [email.getValue(), tenantId.getValue()];
    const result = await this.db.query<UserDatabaseModel>(sql, params);

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return UserMapper.toDomain(row);
  }

  /**
   * Busca un usuario por su id único dentro del contexto del tenant.
   */
  public async findById(id: string, tenantId: TenantId): Promise<User | null> {
    const sql = `
      SELECT id, email, password_hash, tenant_id, roles, phone, created_at, updated_at
      FROM users
      WHERE id = $1 AND tenant_id = $2
      LIMIT 1;
    `;
    const params = [id, tenantId.getValue()];
    const result = await this.db.query<UserDatabaseModel>(sql, params);

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return UserMapper.toDomain(row);
  }

  /**
   * Elimina físicamente un usuario por su id único dentro del contexto del tenant.
   * Retorna true si una fila fue eliminada, false en caso contrario.
   */
  public async delete(id: string, tenantId: TenantId): Promise<boolean> {
    const sql = `
      DELETE FROM users
      WHERE id = $1 AND tenant_id = $2;
    `;
    const params = [id, tenantId.getValue()];
    const result = await this.db.query(sql, params);
    return (result.rowCount ?? 0) > 0;
  }
}