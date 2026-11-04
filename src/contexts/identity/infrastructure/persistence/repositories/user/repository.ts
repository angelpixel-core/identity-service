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
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
}

/**
 * Secondary Adapter: PostgresUserRepository
 * Implementación de UserRepositoryPort sobre PostgreSQL con aislamiento multi-tenant estricto.
 */
export class PostgresUserRepository implements UserRepositoryPort {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * Persiste o actualiza un agregado User en la base de datos PostgreSQL.
   */
  public async save(user: User): Promise<void> {
    const raw = UserMapper.toPersistence(user);
    const sql = `
      INSERT INTO users (id, email, password_hash, tenant_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        updated_at = EXCLUDED.updated_at;
    `;
    const params = [
      raw.id,
      raw.email,
      raw.password_hash,
      raw.tenant_id,
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
      SELECT id, email, password_hash, tenant_id, created_at, updated_at
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
      SELECT id, email, password_hash, tenant_id, created_at, updated_at
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
}