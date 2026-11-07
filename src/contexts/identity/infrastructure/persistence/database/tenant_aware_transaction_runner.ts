import { TenantTransactionRunnerPort } from '../../../application/ports/database/tenant_transaction_runner';
import { TenantId } from '../../../domain/value_objects/tenant_id/value';
import { DatabaseClient } from '../repositories/user/repository';

/**
 * Contrato de cliente de conexión obtenido del pool que incluye método de liberación.
 */
export interface PoolClientWithRelease extends DatabaseClient {
  release(): void;
}

/**
 * Contrato genérico para Connection Pools relacionales (e.g., pg.Pool).
 */
export interface ConnectionPool {
  connect(): Promise<PoolClientWithRelease>;
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
}

/**
 * Secondary Adapter: TenantAwareTransactionRunner
 * Implementa TenantTransactionRunnerPort gestionando transacciones acotadas a un tenant.
 *
 * Propiedades Arquitectónicas:
 * 1. Usa `SET LOCAL app.current_tenant_id = $1` (vía `set_config($1, $2, true)`).
 * 2. El parámetro transaccional expira de forma nativa en PostgreSQL al terminar la transacción (`COMMIT`/`ROLLBACK`).
 * 3. Garantiza que la conexión física regresa al pool totalmente higienizada sin estado residual.
 * 4. Aplica Fail-Closed: las consultas sin este contexto devuelven 0 filas en tablas con RLS.
 */
export class TenantAwareTransactionRunner implements TenantTransactionRunnerPort {
  constructor(private readonly pool: ConnectionPool) { }

  /**
   * Ejecuta una función dentro de un bloque transaccional asociado al contexto del tenant.
   *
   * @param tenantId Identificador del tenant (Value Object o string no vacío).
   * @param operation Callback que recibe el cliente transaccional.
   * @returns Resultado del callback.
   */
  public async runInTenantContext<T>(
    tenantId: TenantId | string,
    operation: (client: DatabaseClient) => Promise<T>
  ): Promise<T> {
    const resolvedTenantId = this.resolveTenantId(tenantId);

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      try {
        await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [
          resolvedTenantId,
          true,
        ]);
      } catch (err) {
        await this.safeRollback(client);
        throw err;
      }

      let result: T;
      try {
        result = await operation(client);
      } catch (err) {
        await this.safeRollback(client);
        throw err;
      }

      try {
        await client.query('COMMIT');
      } catch (err) {
        await this.safeRollback(client);
        throw err;
      }

      return result;
    } finally {
      client.release();
    }
  }

  /**
   * Normaliza y valida el identificador del tenant.
   */
  private resolveTenantId(tenantId: TenantId | string): string {
    if (!tenantId) {
      throw new Error('tenantId cannot be empty');
    }

    const raw = typeof tenantId === 'string' ? tenantId : tenantId.getValue();
    const trimmed = raw.trim();

    if (trimmed.length === 0) {
      throw new Error('tenantId cannot be empty');
    }

    return trimmed;
  }

  /**
   * Ejecuta ROLLBACK de forma segura ignorando errores secundarios para no ocultar la excepción raíz.
   */
  private async safeRollback(client: DatabaseClient): Promise<void> {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignorar fallo de rollback para propagar el error original de negocio
    }
  }
}
