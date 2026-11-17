import { InMemoryHealthAdapter } from '../../../../../src/contexts/shared/domain/health/in_memory_health_adapter';
import { DependencyProbe } from '../../../../../src/contexts/shared/domain/health/dependency_probe';
import { ProbeResult } from '../../../../../src/contexts/shared/domain/health/health_types';

describe('Health Domain: InMemoryHealthAdapter (US-22)', () => {
  let adapter: InMemoryHealthAdapter;

  beforeEach(() => {
    adapter = new InMemoryHealthAdapter();
  });

  describe('checkLiveness', () => {
    it('should return UP with liveness check OK without executing dependency probes', async () => {
      let probeExecuted = false;
      const dummyProbe: DependencyProbe = {
        name: 'database',
        isCritical: true,
        timeoutMs: 1000,
        check: async (): Promise<ProbeResult> => {
          probeExecuted = true;
          return {
            name: 'database',
            status: 'DOWN',
            latencyMs: 10,
            isCritical: true,
            timestamp: new Date().toISOString(),
          };
        },
      };

      adapter.registerProbe(dummyProbe);

      const report = await adapter.checkLiveness();

      expect(report.status).toBe('UP');
      expect(report.checks.liveness).toBeDefined();
      expect(report.checks.liveness!.status).toBe('OK');
      expect(report.checks.liveness!.latencyMs).toBe(0);
      expect(probeExecuted).toBe(false);
    });
  });

  describe('checkReadiness', () => {
    it('should evaluate registered probes in parallel and return aggregated UP', async () => {
      const dbProbe: DependencyProbe = {
        name: 'database',
        isCritical: true,
        timeoutMs: 500,
        check: async (): Promise<ProbeResult> => ({
          name: 'database',
          status: 'OK',
          latencyMs: 10,
          isCritical: true,
          timestamp: new Date().toISOString(),
        }),
      };

      const cacheProbe: DependencyProbe = {
        name: 'cache',
        isCritical: false,
        timeoutMs: 500,
        check: async (): Promise<ProbeResult> => ({
          name: 'cache',
          status: 'OK',
          latencyMs: 5,
          isCritical: false,
          timestamp: new Date().toISOString(),
        }),
      };

      adapter.registerProbe(dbProbe);
      adapter.registerProbe(cacheProbe);

      const report = await adapter.checkReadiness();

      expect(report.status).toBe('UP');
      expect(report.checks.database!.status).toBe('OK');
      expect(report.checks.cache!.status).toBe('OK');
    });

    it('should return DOWN when a critical probe returns status DOWN', async () => {
      const failingDbProbe: DependencyProbe = {
        name: 'database',
        isCritical: true,
        timeoutMs: 500,
        check: async (): Promise<ProbeResult> => ({
          name: 'database',
          status: 'DOWN',
          latencyMs: 25,
          isCritical: true,
          reason: 'PostgreSQL connection failed',
          timestamp: new Date().toISOString(),
        }),
      };

      adapter.registerProbe(failingDbProbe);

      const report = await adapter.checkReadiness();

      expect(report.status).toBe('DOWN');
      expect(report.checks.database!.status).toBe('DOWN');
      expect(report.checks.database!.reason).toBe('PostgreSQL connection failed');
    });

    it('should enforce timeout and mark probe as TIMEOUT when duration exceeds timeoutMs', async () => {
      const hangingProbe: DependencyProbe = {
        name: 'slow_service',
        isCritical: true,
        timeoutMs: 50,
        check: async (): Promise<ProbeResult> => {
          await new Promise((resolve) => setTimeout(resolve, 300));
          return {
            name: 'slow_service',
            status: 'OK',
            latencyMs: 300,
            isCritical: true,
            timestamp: new Date().toISOString(),
          };
        },
      };

      adapter.registerProbe(hangingProbe);

      const report = await adapter.checkReadiness();

      expect(report.status).toBe('DOWN');
      expect(report.checks.slow_service!.status).toBe('TIMEOUT');
      expect(report.checks.slow_service!.reason).toContain('timed out after 50ms');
    });

    it('should catch unhandled exceptions in probe.check() and record as DOWN', async () => {
      const crashingProbe: DependencyProbe = {
        name: 'crashing_dependency',
        isCritical: true,
        timeoutMs: 500,
        check: async (): Promise<ProbeResult> => {
          throw new Error('Socket abruptly closed');
        },
      };

      adapter.registerProbe(crashingProbe);

      const report = await adapter.checkReadiness();

      expect(report.status).toBe('DOWN');
      expect(report.checks.crashing_dependency!.status).toBe('DOWN');
      expect(report.checks.crashing_dependency!.reason).toBe('Socket abruptly closed');
    });
  });

  describe('checkHealth', () => {
    it('should aggregate both liveness and readiness checks in the report', async () => {
      const dbProbe: DependencyProbe = {
        name: 'database',
        isCritical: true,
        timeoutMs: 500,
        check: async (): Promise<ProbeResult> => ({
          name: 'database',
          status: 'OK',
          latencyMs: 8,
          isCritical: true,
          timestamp: new Date().toISOString(),
        }),
      };

      adapter.registerProbe(dbProbe);

      const report = await adapter.checkHealth();

      expect(report.status).toBe('UP');
      expect(report.checks.liveness).toBeDefined();
      expect(report.checks.liveness!.status).toBe('OK');
      expect(report.checks.database).toBeDefined();
      expect(report.checks.database!.status).toBe('OK');
    });
  });

  describe('clearProbes', () => {
    it('should clear all registered probes', async () => {
      adapter.registerProbe({
        name: 'test_probe',
        isCritical: true,
        timeoutMs: 100,
        check: async () => ({
          name: 'test_probe',
          status: 'OK',
          latencyMs: 1,
          isCritical: true,
          timestamp: new Date().toISOString(),
        }),
      });

      adapter.clearProbes();

      const report = await adapter.checkReadiness();
      expect(Object.keys(report.checks)).toHaveLength(0);
      expect(report.status).toBe('UP');
    });
  });
});
