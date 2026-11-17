import request from 'supertest';
import { createApp } from '../../../../interfaces/http/server';
import { InMemoryHealthAdapter } from '../../../../src/contexts/shared/domain/health/in_memory_health_adapter';
import { PostgresProbe, SqlQueryClient } from '../../../../src/contexts/shared/infrastructure/health/probes/postgres_probe';
import { CacheProbe, CacheCheckProvider } from '../../../../src/contexts/shared/infrastructure/health/probes/cache_probe';
import { KeyVaultProbe, KeyVaultProvider } from '../../../../src/contexts/shared/infrastructure/health/probes/keyvault_probe';

describe('Integration API: Infrastructure Health & Readiness Endpoints (US-22)', () => {
  let healthAdapter: InMemoryHealthAdapter;
  let mockDbClient: SqlQueryClient;
  let mockCacheProvider: CacheCheckProvider;
  let mockKeyProvider: KeyVaultProvider;

  beforeEach(() => {
    healthAdapter = new InMemoryHealthAdapter();

    mockDbClient = {
      query: async () => ({ rows: [{ alive: 1 }] }),
    };

    mockCacheProvider = {
      get: async () => null,
    };

    mockKeyProvider = {
      getJwks: async () => ({
        keys: [
          {
            kty: 'RSA',
            use: 'sig',
            alg: 'RS256',
            kid: 'test-key-1',
            n: 'modulus',
            e: 'AQAB',
          },
        ],
      }),
    };

    healthAdapter.registerProbe(new PostgresProbe(mockDbClient, 500));
    healthAdapter.registerProbe(new CacheProbe(mockCacheProvider, 500));
    healthAdapter.registerProbe(new KeyVaultProbe(mockKeyProvider, 500));
  });

  describe('Liveness Probe (/health/live & /health/liveness)', () => {
    it('should return HTTP 200 with status UP on /health/live', async () => {
      const app = createApp({ healthCheckPort: healthAdapter });
      const response = await request(app).get('/health/live');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'UP');
      expect(response.body.checks).toHaveProperty('liveness');
      expect(response.body.checks.liveness.status).toBe('OK');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should return HTTP 200 with status UP on canonical /health/liveness', async () => {
      const app = createApp({ healthCheckPort: healthAdapter });
      const response = await request(app).get('/health/liveness');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'UP');
      expect(response.body.checks.liveness.status).toBe('OK');
    });

    it('should maintain liveness HTTP 200 UP even when a critical dependency is down', async () => {
      // Simulate database failure
      mockDbClient.query = async () => {
        throw new Error('Database connection failed');
      };

      const app = createApp({ healthCheckPort: healthAdapter });
      const response = await request(app).get('/health/live');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('UP');
    });
  });

  describe('Readiness Probe (/health/ready & /health/readiness)', () => {
    it('should return HTTP 200 with status UP when all dependencies are healthy', async () => {
      const app = createApp({ healthCheckPort: healthAdapter });
      const response = await request(app).get('/health/ready');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'UP');
      expect(response.body.checks).toHaveProperty('database');
      expect(response.body.checks.database.status).toBe('OK');
      expect(response.body.checks).toHaveProperty('cache');
      expect(response.body.checks.cache.status).toBe('OK');
      expect(response.body.checks).toHaveProperty('keyvault');
      expect(response.body.checks.keyvault.status).toBe('OK');
    });

    it('should return HTTP 200 on canonical alias /health/readiness', async () => {
      const app = createApp({ healthCheckPort: healthAdapter });
      const response = await request(app).get('/health/readiness');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('UP');
    });

    it('should return HTTP 503 with status DOWN when PostgreSQL database fails', async () => {
      mockDbClient.query = async () => {
        throw new Error('Connection refused: 5432');
      };

      const app = createApp({ healthCheckPort: healthAdapter });
      const response = await request(app).get('/health/ready');

      expect(response.status).toBe(503);
      expect(response.body).toHaveProperty('status', 'DOWN');
      expect(response.body.checks.database.status).toBe('DOWN');
      expect(response.body.checks.database.reason).toBe('Connection refused: 5432');
    });

    it('should return HTTP 503 with status DOWN when KeyVault has no active keys', async () => {
      mockKeyProvider.getJwks = async () => ({ keys: [] });

      const app = createApp({ healthCheckPort: healthAdapter });
      const response = await request(app).get('/health/ready');

      expect(response.status).toBe(503);
      expect(response.body).toHaveProperty('status', 'DOWN');
      expect(response.body.checks.keyvault.status).toBe('DOWN');
      expect(response.body.checks.keyvault.reason).toBe('No active signing keys available in JWKS');
    });

    it('should return HTTP 200 with status DEGRADED when non-critical cache fails', async () => {
      mockCacheProvider.get = async () => {
        throw new Error('Redis cluster failover');
      };

      const app = createApp({ healthCheckPort: healthAdapter });
      const response = await request(app).get('/health/ready');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'DEGRADED');
      expect(response.body.checks.cache.status).toBe('DOWN');
      expect(response.body.checks.database.status).toBe('OK');
      expect(response.body.checks.keyvault.status).toBe('OK');
    });
  });

  describe('Aggregated Health Endpoint (/health)', () => {
    it('should return HTTP 200 with consolidated report when dependencies are healthy', async () => {
      const app = createApp({ healthCheckPort: healthAdapter });
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('UP');
      expect(response.body.checks).toHaveProperty('liveness');
      expect(response.body.checks.liveness.status).toBe('OK');
      expect(response.body.checks).toHaveProperty('database');
      expect(response.body.checks.database.status).toBe('OK');
      expect(response.body.checks).toHaveProperty('cache');
      expect(response.body.checks.cache.status).toBe('OK');
      expect(response.body.checks).toHaveProperty('keyvault');
      expect(response.body.checks.keyvault.status).toBe('OK');
    });

    it('should return HTTP 503 when overall status is DOWN', async () => {
      mockDbClient.query = async () => {
        throw new Error('Fatal database corruption');
      };

      const app = createApp({ healthCheckPort: healthAdapter });
      const response = await request(app).get('/health');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('DOWN');
      expect(response.body.checks.liveness.status).toBe('OK');
      expect(response.body.checks.database.status).toBe('DOWN');
    });
  });
});
