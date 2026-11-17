import { DependencyProbe } from '../../../domain/health/dependency_probe';
import { ProbeResult } from '../../../domain/health/health_types';

export interface KeyVaultProvider {
  getJwks(): Promise<{ keys: readonly unknown[] }>;
}

export class KeyVaultProbe implements DependencyProbe {
  public readonly name = 'keyvault';
  public readonly isCritical = true;

  constructor(
    private readonly keyProvider: KeyVaultProvider,
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
          reason: `KeyVault probe timed out after ${this.timeoutMs}ms`,
          timestamp: new Date().toISOString(),
        });
      }, this.timeoutMs);
    });

    const executionPromise = (async (): Promise<ProbeResult> => {
      try {
        const jwks = await this.keyProvider.getJwks();
        const latencyMs = Date.now() - start;

        if (!jwks || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
          return {
            name: this.name,
            status: 'DOWN',
            latencyMs,
            isCritical: this.isCritical,
            reason: 'No active signing keys available in JWKS',
            timestamp: new Date().toISOString(),
          };
        }

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
          reason: error instanceof Error ? error.message : 'KeyVault probe failed',
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
