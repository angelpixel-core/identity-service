import { DependencyProbe } from '../../../domain/health/dependency_probe';
import { ProbeResult } from '../../../domain/health/health_types';

export interface SqlQueryClient {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

export class PostgresProbe implements DependencyProbe {
  public readonly name = 'database';
  public readonly isCritical = true;

  constructor(
    private readonly client: SqlQueryClient,
    public readonly timeoutMs: number = 1000
  ) {}

  public async check(): Promise<ProbeResult> {
    const start = Date.now();
    let timer: NodeJS.Timeout | null = null;

    const timeoutPromise = new Promise<ProbeResult>((resolve) => {
      timer = setTimeout(() => {
        resolve({
          name: this.name,
          status: 'TIMEOUT',
          latencyMs: this.timeoutMs,
          isCritical: this.isCritical,
          reason: `PostgreSQL query timed out after ${this.timeoutMs}ms`,
          timestamp: new Date().toISOString(),
        });
      }, this.timeoutMs);
    });

    const executionPromise = (async (): Promise<ProbeResult> => {
      try {
        await this.client.query('SELECT 1 AS alive');
        const latencyMs = Date.now() - start;
        return {
          name: this.name,
          status: 'OK',
          latencyMs,
          isCritical: this.isCritical,
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        const latencyMs = Date.now() - start;
        return {
          name: this.name,
          status: 'DOWN',
          latencyMs,
          isCritical: this.isCritical,
          reason: error instanceof Error ? error.message : 'PostgreSQL query failed',
          timestamp: new Date().toISOString(),
        };
      }
    })();

    try {
      return await Promise.race([executionPromise, timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
