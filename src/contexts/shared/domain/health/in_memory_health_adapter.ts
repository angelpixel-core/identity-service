import { DependencyProbe } from './dependency_probe';
import { HealthCheckPort } from './health_check_port';
import { HealthAggregator, HealthReport, ProbeResult } from './health_types';

export class InMemoryHealthAdapter implements HealthCheckPort {
  private readonly probes: Map<string, DependencyProbe> = new Map();

  public registerProbe(probe: DependencyProbe): void {
    this.probes.set(probe.name, probe);
  }

  public clearProbes(): void {
    this.probes.clear();
  }

  public async checkLiveness(): Promise<HealthReport> {
    const livenessResult: ProbeResult = Object.freeze({
      name: 'liveness',
      status: 'OK',
      latencyMs: 0,
      isCritical: true,
      timestamp: new Date().toISOString(),
    });

    return Object.freeze({
      status: 'UP',
      checks: Object.freeze({ liveness: livenessResult }),
      timestamp: new Date().toISOString(),
    });
  }

  public async checkReadiness(): Promise<HealthReport> {
    const results = await this.executeAllProbes();
    return HealthAggregator.aggregate(results);
  }

  public async checkHealth(): Promise<HealthReport> {
    const livenessReport = await this.checkLiveness();
    const results = await this.executeAllProbes();
    const readinessReport = HealthAggregator.aggregate(results);

    const checks: Record<string, ProbeResult> = {
      ...livenessReport.checks,
      ...readinessReport.checks,
    };

    return Object.freeze({
      status: readinessReport.status,
      checks: Object.freeze(checks),
      timestamp: new Date().toISOString(),
    });
  }

  private async executeAllProbes(): Promise<ProbeResult[]> {
    const probeList = Array.from(this.probes.values());
    if (probeList.length === 0) {
      return [];
    }

    const promises = probeList.map((probe) => this.executeProbeWithTimeout(probe));
    return Promise.all(promises);
  }

  private async executeProbeWithTimeout(probe: DependencyProbe): Promise<ProbeResult> {
    const start = Date.now();
    let timer: NodeJS.Timeout | null = null;

    const timeoutPromise = new Promise<ProbeResult>((resolve) => {
      timer = setTimeout(() => {
        resolve({
          name: probe.name,
          status: 'TIMEOUT',
          latencyMs: probe.timeoutMs,
          isCritical: probe.isCritical,
          reason: `Probe '${probe.name}' timed out after ${probe.timeoutMs}ms`,
          timestamp: new Date().toISOString(),
        });
      }, probe.timeoutMs);
    });

    try {
      const probePromise = probe.check();
      const result = await Promise.race([probePromise, timeoutPromise]);
      return result;
    } catch (error) {
      return {
        name: probe.name,
        status: 'DOWN',
        latencyMs: Date.now() - start,
        isCritical: probe.isCritical,
        reason: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
