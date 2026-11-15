import { Pool, PoolConfig } from 'pg';
import {
  ConnectionPool,
  PoolClientWithRelease,
} from './tenant_aware_transaction_runner';
import {
  createSecurePostgresConfig,
  PostgresSslOptions,
  SecurityConfigurationError,
} from './postgres_ssl_config';

export { PostgresSslOptions, SecurityConfigurationError };

export interface DynamicPoolManagerOptions {
  readonly connectionString?: string;
  readonly poolConfig?: PoolConfig;
  readonly initialPool?: Pool;
  readonly poolFactory?: (config: PoolConfig | string) => Pool;
  readonly healthTimeoutMs?: number;
  readonly drainGracePeriodMs?: number;
  readonly sslOptions?: PostgresSslOptions;
}

export interface DynamicPoolStats {
  readonly generation: number;
  readonly isClosed: boolean;
  readonly retiringPoolsCount: number;
  readonly activePoolTotalCount?: number;
  readonly activePoolIdleCount?: number;
  readonly activePoolWaitingCount?: number;
}

/**
 * Adapter: DynamicPostgresPoolManager
 * Administrador dinámico de pools de conexión para PostgreSQL (node-pg).
 *
 * Implementa el contrato ConnectionPool permitiendo la recarga en caliente de credenciales
 * rotadas por Azure Key Vault Secrets Store CSI Driver sin tiempo de inactividad (Zero-Downtime).
 *
 * Propiedades:
 * 1. Swap atómico de puntero de pool con incremento de generación.
 * 2. Comprobación de salud previa (SELECT 1 con timeout) antes de aplicar el swap (Fail-Safe).
 * 3. Drenado ordenado y gradual del pool previo (pool.end()) preservando transacciones en vuelo.
 * 4. Cumplimiento con PCI-DSS v4.0 Req 3.6 y SOC 2 Type II CC6.1.
 */
export class DynamicPostgresPoolManager implements ConnectionPool {
  private activePool: Pool;
  private generation: number;
  private isShuttingDown: boolean;
  private readonly retiringPools: Set<Pool>;
  private readonly poolFactory: (config: PoolConfig | string) => Pool;
  private readonly healthTimeoutMs: number;
  private readonly drainGracePeriodMs: number;
  private readonly sslOptions?: PostgresSslOptions;

  constructor(options: DynamicPoolManagerOptions) {
    this.sslOptions = options.sslOptions;
    this.poolFactory = options.poolFactory ?? ((cfg) => (typeof cfg === 'string' ? new Pool({ connectionString: cfg }) : new Pool(cfg)));
    this.healthTimeoutMs = options.healthTimeoutMs ?? 5000;
    this.drainGracePeriodMs = options.drainGracePeriodMs ?? 1000;
    this.generation = 1;
    this.isShuttingDown = false;
    this.retiringPools = new Set<Pool>();

    if (options.initialPool) {
      this.activePool = options.initialPool;
    } else if (options.poolConfig) {
      const secureConfig = createSecurePostgresConfig(options.poolConfig, this.sslOptions);
      this.activePool = this.poolFactory(secureConfig);
    } else if (options.connectionString) {
      const secureConfig = createSecurePostgresConfig(options.connectionString, this.sslOptions);
      this.activePool = this.poolFactory(secureConfig);
    } else {
      throw new Error(
        'DynamicPostgresPoolManager requires either initialPool, poolConfig or connectionString'
      );
    }
  }

  /**
   * Adquiere un cliente de conexión del pool activo.
   */
  public async connect(): Promise<PoolClientWithRelease> {
    this.assertNotClosed();
    const client = await this.activePool.connect();
    return client;
  }

  /**
   * Ejecuta una consulta SQL en el pool activo.
   */
  public async query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }> {
    this.assertNotClosed();
    const result = await this.activePool.query(sql, params);
    return { rows: result.rows as T[] };
  }

  /**
   * Recarga las credenciales de conexión realizando un swap atómico con verificación previa.
   * Si la verificación de conectividad (SELECT 1) falla, el pool candidato es descartado
   * y el pool activo se conserva intacto (Fail-Safe).
   *
   * Cumple con PCI-DSS v4.0 Req 4.1 y SOC 2 CC6.7:
   * Aplica un Anti-Downgrade Guard que aborta inmediatamente con SecurityConfigurationError
   * ante cualquier intento de deshabilitar SSL o la verificación de certificados.
   */
  public async reloadCredentials(newConfig: PoolConfig | string): Promise<void> {
    this.assertNotClosed();

    if (!newConfig || (typeof newConfig === 'string' && newConfig.trim().length === 0)) {
      throw new Error('Invalid connection configuration provided for reload');
    }

    // 1. Blindar configuración candidata con políticas SSL estrictas (Anti-Downgrade Guard)
    const secureCandidateConfig = createSecurePostgresConfig(newConfig, this.sslOptions);

    // 2. Instanciar pool candidato
    const candidatePool = this.poolFactory(secureCandidateConfig);

    // 3. Ejecutar prueba de salud (SELECT 1) con timeout determinista
    try {
      await this.verifyPoolHealth(candidatePool);
    } catch (err: unknown) {
      // Descartar inmediatamente el pool candidato y propagar excepción
      try {
        await candidatePool.end();
      } catch {
        // Ignorar fallos al cerrar pool candidato fallido
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to reload database pool with new credentials: ${msg}`);
    }

    // 4. Swap Atómico de Punteros
    const oldPool = this.activePool;
    this.activePool = candidatePool;
    this.generation += 1;

    // 5. Drenado Ordenado del Pool Previo (Graceful Drain)
    this.retiringPools.add(oldPool);
    setTimeout(async () => {
      try {
        await oldPool.end();
      } catch {
        // Ignorar errores durante drenado de conexiones residuales
      } finally {
        this.retiringPools.delete(oldPool);
      }
    }, this.drainGracePeriodMs);
  }

  /**
   * Retorna las opciones de SSL configuradas para el gestor de pools.
   */
  public getSslOptions(): PostgresSslOptions | undefined {
    return this.sslOptions;
  }

  /**
   * Retorna el número de generación actual del pool (inicia en 1 y se incrementa en cada swap).
   */
  public getGeneration(): number {
    return this.generation;
  }

  /**
   * Retorna una referencia al pool activo de node-pg.
   */
  public getActivePool(): Pool {
    return this.activePool;
  }

  /**
   * Retorna estadísticas y métricas del estado del gestor.
   */
  public getStats(): DynamicPoolStats {
    const pool = this.activePool as any;
    return {
      generation: this.generation,
      isClosed: this.isShuttingDown,
      retiringPoolsCount: this.retiringPools.size,
      activePoolTotalCount: pool.totalCount,
      activePoolIdleCount: pool.idleCount,
      activePoolWaitingCount: pool.waitingCount,
    };
  }

  /**
   * Cierra ordenadamente el pool activo y todos los pools en fase de retiro.
   */
  public async close(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }
    this.isShuttingDown = true;

    const closePromises: Promise<void>[] = [];

    // Cerrar pool activo
    closePromises.push(
      this.activePool.end().catch(() => undefined)
    );

    // Cerrar pools en fase de retiro
    for (const pool of this.retiringPools) {
      closePromises.push(
        pool.end().catch(() => undefined)
      );
    }
    this.retiringPools.clear();

    await Promise.all(closePromises);
  }

  /**
   * Comprueba la conectividad del pool ejecutando SELECT 1 con timeout.
   */
  private async verifyPoolHealth(pool: Pool): Promise<void> {
    let timer: NodeJS.Timeout | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Database health check timed out after ${this.healthTimeoutMs}ms`));
      }, this.healthTimeoutMs);
    });

    try {
      await Promise.race([
        pool.query('SELECT 1 AS health_check'),
        timeoutPromise,
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Verifica que el gestor no haya sido cerrado previamente.
   */
  private assertNotClosed(): void {
    if (this.isShuttingDown) {
      throw new Error('DynamicPostgresPoolManager is closed and cannot accept queries');
    }
  }
}
