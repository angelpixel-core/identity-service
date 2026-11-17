import {
  CacheProbe,
  CacheCheckProvider,
} from '../../../../../src/contexts/shared/infrastructure/health/probes/cache_probe';

describe('Infrastructure Health Probe: CacheProbe (US-22)', () => {
  it('should return status OK with isCritical false when cache read succeeds', async () => {
    let queriedKey = '';
    const mockCache: CacheCheckProvider = {
      get: async (key: string) => {
        queriedKey = key;
        return null;
      },
    };

    const probe = new CacheProbe(mockCache, 500);
    const result = await probe.check();

    expect(queriedKey).toBe('__health_probe__');
    expect(result.name).toBe('cache');
    expect(result.status).toBe('OK');
    expect(result.isCritical).toBe(false);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.timestamp).toBeDefined();
  });

  it('should return status DOWN with isCritical false when cache read throws', async () => {
    const mockCache: CacheCheckProvider = {
      get: async () => {
        throw new Error('Redis connection refused: ECONNREFUSED');
      },
    };

    const probe = new CacheProbe(mockCache, 500);
    const result = await probe.check();

    expect(result.name).toBe('cache');
    expect(result.status).toBe('DOWN');
    expect(result.isCritical).toBe(false);
    expect(result.reason).toBe('Redis connection refused: ECONNREFUSED');
  });

  it('should return status TIMEOUT when cache operation exceeds timeoutMs', async () => {
    const mockCache: CacheCheckProvider = {
      get: async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return 'data';
      },
    };

    const probe = new CacheProbe(mockCache, 30);
    const result = await probe.check();

    expect(result.name).toBe('cache');
    expect(result.status).toBe('TIMEOUT');
    expect(result.isCritical).toBe(false);
    expect(result.reason).toContain('Cache probe timed out after 30ms');
  });
});
