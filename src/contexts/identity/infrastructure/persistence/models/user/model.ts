/**
 * Database Persistence Model / SQL Schema Definition for 'users' table.
 * Define la estructura de las tuplas en PostgreSQL.
 */
export interface UserDatabaseModel {
  readonly id: string;
  readonly email: string;
  readonly password_hash: string;
  readonly tenant_id: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}
