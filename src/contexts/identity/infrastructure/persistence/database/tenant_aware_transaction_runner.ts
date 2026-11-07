import { TenantTransactionRunnerPort } from '../../../application/ports/database/tenant_transaction_runner';
import { TenantId } from '../../../domain/value_objects/tenant_id/value';
import { TenantSessionContext } from '../../../domain/value_objects/tenant_session_context/value';
import { DatabaseClient } from '../repositories/user/repository';

/**
 * Contrato de cliente de conexión obtenido del pool que incluye método de liberación.
 * En pg, pasar un valor truthy a release(err) descarta y destruye la conexión física del pool.
 */
export interface PoolClientWithRelease extends DatabaseClient {
  release(err?: any): void;
}

/**
 * Contrato genérico para Connection Pools relacionales (e.g., pg.Pool).
 */
export interface ConnectionPool {
  connect(): Promise<PoolClientWithRelease>;
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
}

/**
 * Contrato genérico de logging para observabilidad de infraestructura.
 */
export interface TransactionLogger {
  error(message: string, ...meta: any[]): void;
  warn?(message: string, ...meta: any[]): void;
  info?(message: string, ...meta: any[]): void;
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
 * 5. Prevención de intoxicación de pool: si ocurre un fallo en rollback o transacción, `release(true)` descarta la conexión.
 * 6. Observabilidad y encadenamiento: los fallos en rollback se registran en el logger y se anexan a la excepción raíz.
 */
export class TenantAwareTransactionRunner implements TenantTransactionRunnerPort {
  constructor(
    private readonly pool: ConnectionPool,
    private readonly logger: TransactionLogger = console
  ) {}

  /**
   * Ejecuta una función dentro de un bloque transaccional asociado al contexto del tenant.
   *
   * @param tenant Identificador del tenant (TenantSessionContext, TenantId o string no vacío).
   * @param operation Callback que recibe el cliente transaccional y el contexto de sesión activo.
   * @returns Resultado del callback.
   */
  public async runInTenantContext<T>(
    tenant: TenantSessionContext | TenantId | string,
    operation: (client: DatabaseClient, session: TenantSessionContext) => Promise<T>
  ): Promise<T> {
    const session = this.resolveSessionContext(tenant);
    const resolvedTenantId = session.getTenantIdValue();
    const client = await this.pool.connect();
    let hasError = false;

    try {
      try {
        await client.query('BEGIN');
      } catch (err) {
        hasError = true;
        throw err;
      }

      try {
        await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [
          resolvedTenantId,
          true,
        ]);
      } catch (err) {
        hasError = true;
        await this.handleRollback(client, err, 'set_config');
        throw err;
      }

      let result: T;
      try {
        result = await operation(client, session);
      } catch (err) {
        hasError = true;
        await this.handleRollback(client, err, 'operation');
        throw err;
      }

      try {
        await client.query('COMMIT');
      } catch (err) {
        hasError = true;
        await this.handleRollback(client, err, 'commit');
        throw err;
      }

      return result;
    } catch (rootError) {
      hasError = true;
      throw rootError;
    } finally {
      if (typeof client.release === 'function') {
        client.release(hasError);
      }
    }
  }

  /**
   * Normaliza y valida el identificador o contexto del tenant devolviendo un TenantSessionContext.
   */
  private resolveSessionContext(tenant: TenantSessionContext | TenantId | string): TenantSessionContext {
    if (!tenant) {
      throw new Error('tenantId cannot be empty');
    }

    if (tenant instanceof TenantSessionContext) {
      return tenant;
    }

    const raw = typeof tenant === 'string' ? tenant : tenant.getValue();
    const trimmed = raw.trim();

    if (trimmed.length === 0) {
      throw new Error('tenantId cannot be empty');
    }

    return TenantSessionContext.create(trimmed);
  }

  /**
   * Ejecuta ROLLBACK registrando fallos en observabilidad y encadenando el error a la excepción primaria.
   */
  private async handleRollback(
    client: DatabaseClient,
    primaryError: unknown,
    stage: 'set_config' | 'operation' | 'commit'
  ): Promise<void> {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      this.logger.error(
        `[TenantAwareTransactionRunner] Critical failure executing ROLLBACK during stage '${stage}'. Discarding connection from pool.`,
        { primaryError, rollbackError }
      );

      if (primaryError instanceof Error && rollbackError instanceof Error) {
        (primaryError as any).rollbackError = rollbackError;
      }
    }
  }
}
