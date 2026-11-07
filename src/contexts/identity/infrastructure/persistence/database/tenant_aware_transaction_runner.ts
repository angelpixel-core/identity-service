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
 * 7. Soporte para Savepoints y Anidamiento: soporta llamadas anidadas verificando la invariante anti-cross-tenant con `TenantSessionContext`.
 */
export class TenantAwareTransactionRunner implements TenantTransactionRunnerPort {
  private static readonly activeSessions = new WeakMap<DatabaseClient, TenantSessionContext>();

  constructor(
    private readonly pool: ConnectionPool,
    private readonly logger: TransactionLogger = console,
    private readonly boundClient?: DatabaseClient,
    private readonly boundSession?: TenantSessionContext
  ) {}

  /**
   * Crea una instancia del runner vinculada a un cliente transaccional y contexto de sesión específicos.
   */
  public withClient(client: DatabaseClient, session: TenantSessionContext): TenantAwareTransactionRunner {
    return new TenantAwareTransactionRunner(this.pool, this.logger, client, session);
  }

  /**
   * Ejecuta una función dentro de un bloque transaccional asociado al contexto del tenant.
   * Si se especifica un existingClient (o el runner fue creado con withClient), utiliza Savepoints.
   *
   * @param tenant Identificador del tenant (TenantSessionContext, TenantId o string no vacío).
   * @param operation Callback que recibe el cliente transaccional y el contexto de sesión activo.
   * @param existingClient Conexión opcional para anidamiento transaccional.
   * @returns Resultado del callback.
   */
  public async runInTenantContext<T>(
    tenant: TenantSessionContext | TenantId | string,
    operation: (client: DatabaseClient, session: TenantSessionContext) => Promise<T>,
    existingClient?: DatabaseClient
  ): Promise<T> {
    const targetSession = this.resolveSessionContext(tenant);
    const clientToUse = existingClient || this.boundClient;

    // Si ya existe una conexión transaccional activa, operamos bajo Savepoint
    if (clientToUse) {
      return this.executeInNestedSavepoint(clientToUse, targetSession, operation);
    }

    // Flujo raíz: adquisición de conexión desde el pool y apertura de transacción BEGIN
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
          targetSession.getTenantIdValue(),
          true,
        ]);
        TenantAwareTransactionRunner.activeSessions.set(client, targetSession);
      } catch (err) {
        hasError = true;
        await this.handleRollback(client, err, 'set_config');
        throw err;
      }

      let result: T;
      try {
        result = await operation(client, targetSession);
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
      TenantAwareTransactionRunner.activeSessions.delete(client);
      if (typeof client.release === 'function') {
        client.release(hasError);
      }
    }
  }

  /**
   * Ejecuta la operación bajo un Savepoint garantizando que no exista violación cross-tenant.
   */
  private async executeInNestedSavepoint<T>(
    client: DatabaseClient,
    targetSession: TenantSessionContext,
    operation: (client: DatabaseClient, session: TenantSessionContext) => Promise<T>
  ): Promise<T> {
    const activeSession = this.boundSession || TenantAwareTransactionRunner.activeSessions.get(client);

    // Invariante de seguridad: si hay una sesión activa en la conexión, debe coincidir estrictamente
    if (activeSession) {
      activeSession.assertMatchingTenant(targetSession.getTenantId());
    }

    const savepointName = `sp_${Math.random().toString(36).substring(2, 9)}`;

    await client.query(`SAVEPOINT ${savepointName}`);

    try {
      const result = await operation(client, targetSession);
      await client.query(`RELEASE SAVEPOINT ${savepointName}`);
      return result;
    } catch (err) {
      try {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
      } catch (rollbackErr) {
        this.logger.error(
          `[TenantAwareTransactionRunner] Failure executing ROLLBACK TO SAVEPOINT '${savepointName}'.`,
          { err, rollbackErr }
        );
      }
      throw err;
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
