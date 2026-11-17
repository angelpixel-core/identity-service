export type HealthStatus = 'UP' | 'DOWN' | 'DEGRADED';
export type ProbeStatus = 'OK' | 'DOWN' | 'TIMEOUT';

export interface ProbeResult {
  readonly name: string;
  readonly status: ProbeStatus;
  readonly latencyMs: number;
  readonly isCritical: boolean;
  readonly reason?: string;
  readonly timestamp: string;
}

export interface HealthReport {
  readonly status: HealthStatus;
  readonly checks: Record<string, ProbeResult>;
  readonly timestamp: string;
}

export class HealthAggregator {
  public static aggregate(results: ProbeResult[]): HealthReport {
    let hasCriticalFailure = false;
    let hasNonCriticalFailure = false;
    const checks: Record<string, ProbeResult> = {};

    for (const result of results) {
      checks[result.name] = result;
      if (result.status !== 'OK') {
        if (result.isCritical) {
          hasCriticalFailure = true;
        } else {
          hasNonCriticalFailure = true;
        }
      }
    }

    let status: HealthStatus = 'UP';
    if (hasCriticalFailure) {
      status = 'DOWN';
    } else if (hasNonCriticalFailure) {
      status = 'DEGRADED';
    }

    return Object.freeze({
      status,
      checks: Object.freeze(checks),
      timestamp: new Date().toISOString(),
    });
  }
}
