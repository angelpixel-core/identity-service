import { DependencyProbe } from '../../../domain/health/dependency_probe';
import { ProbeResult } from '../../../domain/health/health_types';

export interface CacheCheckProvider {
  get(key: string): Promise<unknown>;
}

export class CacheProbe implements DependencyProbe {
  public readonly name = 'cache';
  public readonly isCritical = false;

  constructor(
    private readonly cacheProvider: CacheCheckProvider,
    public readonly timeoutMs: number = 500
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
          reason: `Cache probe timed out after ${this.timeoutMs}ms`,
          timestamp: new Date().toISOString(),
        });
      }, this.timeoutMs);
    });

    const executionPromise = (async (): Promise<ProbeResult> => {
      try {
        await this.cacheProvider.get('__health_probe__');
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
          reason: error instanceof Error ? error.message : 'Cache provider unreachable',
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
