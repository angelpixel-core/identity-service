import {
  HealthAggregator,
  ProbeResult,
} from '../../../../../src/contexts/shared/domain/health/health_types';

describe('Health Domain: Health Types & HealthAggregator (US-22)', () => {
  describe('ProbeResult & HealthReport immutability', () => {
    it('should aggregate probes into a frozen HealthReport object', () => {
      const probe1: ProbeResult = Object.freeze({
        name: 'database',
        status: 'OK',
        latencyMs: 12,
        isCritical: true,
        timestamp: new Date().toISOString(),
      });

      const report = HealthAggregator.aggregate([probe1]);

      expect(report).toBeDefined();
      expect(report.status).toBe('UP');
      expect(report.checks.database).toBeDefined();
      expect(report.checks.database!.status).toBe('OK');
      expect(report.checks.database!.latencyMs).toBe(12);
      expect(Object.isFrozen(report)).toBe(true);
      expect(Object.isFrozen(report.checks)).toBe(true);
    });
  });

  describe('HealthAggregator Rules', () => {
    it('should return UP when all probes are OK', () => {
      const probes: ProbeResult[] = [
        {
          name: 'database',
          status: 'OK',
          latencyMs: 5,
          isCritical: true,
          timestamp: new Date().toISOString(),
        },
        {
          name: 'cache',
          status: 'OK',
          latencyMs: 2,
          isCritical: false,
          timestamp: new Date().toISOString(),
        },
        {
          name: 'keyvault',
          status: 'OK',
          latencyMs: 8,
          isCritical: true,
          timestamp: new Date().toISOString(),
        },
      ];

      const report = HealthAggregator.aggregate(probes);

      expect(report.status).toBe('UP');
      expect(Object.keys(report.checks)).toHaveLength(3);
      expect(report.checks.database!.status).toBe('OK');
      expect(report.checks.cache!.status).toBe('OK');
      expect(report.checks.keyvault!.status).toBe('OK');
    });

    it('should return DOWN when a critical probe has status DOWN', () => {
      const probes: ProbeResult[] = [
        {
          name: 'database',
          status: 'DOWN',
          latencyMs: 50,
          isCritical: true,
          reason: 'Connection refused',
          timestamp: new Date().toISOString(),
        },
        {
          name: 'cache',
          status: 'OK',
          latencyMs: 2,
          isCritical: false,
          timestamp: new Date().toISOString(),
        },
      ];

      const report = HealthAggregator.aggregate(probes);

      expect(report.status).toBe('DOWN');
      expect(report.checks.database!.status).toBe('DOWN');
      expect(report.checks.database!.reason).toBe('Connection refused');
      expect(report.checks.cache!.status).toBe('OK');
    });

    it('should return DOWN when a critical probe has status TIMEOUT', () => {
      const probes: ProbeResult[] = [
        {
          name: 'keyvault',
          status: 'TIMEOUT',
          latencyMs: 1500,
          isCritical: true,
          reason: 'Operation timed out',
          timestamp: new Date().toISOString(),
        },
        {
          name: 'database',
          status: 'OK',
          latencyMs: 5,
          isCritical: true,
          timestamp: new Date().toISOString(),
        },
      ];

      const report = HealthAggregator.aggregate(probes);

      expect(report.status).toBe('DOWN');
      expect(report.checks.keyvault!.status).toBe('TIMEOUT');
    });

    it('should return DEGRADED when a non-critical probe fails and all critical probes are OK', () => {
      const probes: ProbeResult[] = [
        {
          name: 'database',
          status: 'OK',
          latencyMs: 5,
          isCritical: true,
          timestamp: new Date().toISOString(),
        },
        {
          name: 'cache',
          status: 'DOWN',
          latencyMs: 20,
          isCritical: false,
          reason: 'Redis cluster failover',
          timestamp: new Date().toISOString(),
        },
      ];

      const report = HealthAggregator.aggregate(probes);

      expect(report.status).toBe('DEGRADED');
      expect(report.checks.database!.status).toBe('OK');
      expect(report.checks.cache!.status).toBe('DOWN');
    });

    it('should prioritize DOWN over DEGRADED if both critical and non-critical probes fail', () => {
      const probes: ProbeResult[] = [
        {
          name: 'database',
          status: 'DOWN',
          latencyMs: 10,
          isCritical: true,
          timestamp: new Date().toISOString(),
        },
        {
          name: 'cache',
          status: 'DOWN',
          latencyMs: 15,
          isCritical: false,
          timestamp: new Date().toISOString(),
        },
      ];

      const report = HealthAggregator.aggregate(probes);

      expect(report.status).toBe('DOWN');
    });

    it('should return UP when empty probe list is provided', () => {
      const report = HealthAggregator.aggregate([]);

      expect(report.status).toBe('UP');
      expect(Object.keys(report.checks)).toHaveLength(0);
      expect(report.timestamp).toBeDefined();
    });
  });
});
