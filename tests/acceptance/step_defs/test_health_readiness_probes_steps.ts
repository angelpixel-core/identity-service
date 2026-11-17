import request from 'supertest';
import { createApp } from '../../../interfaces/http/server';
import { InMemoryHealthAdapter } from '../../../src/contexts/shared/domain/health/in_memory_health_adapter';
import { DependencyProbe } from '../../../src/contexts/shared/domain/health/dependency_probe';
import { ProbeResult } from '../../../src/contexts/shared/domain/health/health_types';

describe('Feature: Infrastructure Health and Readiness Probes (US-22)', () => {
  describe('Scenario: Liveness probe succeeds while application loop is healthy', () => {
    let healthAdapter: InMemoryHealthAdapter;
    let app: ReturnType<typeof createApp>;

    beforeEach(() => {
      healthAdapter = new InMemoryHealthAdapter();
      app = createApp({ healthCheckPort: healthAdapter });
    });

    it('should return HTTP 200 with status UP and liveness check OK', async () => {
      // Given: the identity service process is running
      // When: a probe request is made to "/health/live"
      const response = await request(app).get('/health/live');

      // Then: the response status code should be 200
      expect(response.status).toBe(200);

      // And: the response body should contain status "UP"
      expect(response.body.status).toBe('UP');

      // And: the response body should include liveness check "OK"
      expect(response.body.checks).toBeDefined();
      const livenessCheck = response.body.checks.liveness;
      const livenessStatus = typeof livenessCheck === 'object' ? livenessCheck.status : livenessCheck;
      expect(livenessStatus).toBe('OK');
    });
  });

  describe('Scenario: Readiness probe returns 200 when all critical dependencies are healthy', () => {
    let healthAdapter: InMemoryHealthAdapter;
    let app: ReturnType<typeof createApp>;

    beforeEach(() => {
      healthAdapter = new InMemoryHealthAdapter();
      // Given: the PostgreSQL database connection is operational
      healthAdapter.registerProbe({
        name: 'database',
        isCritical: true,
        timeoutMs: 1500,
        async check(): Promise<ProbeResult> {
          return {
            name: 'database',
            status: 'OK',
            isCritical: true,
            latencyMs: 1.5,
            timestamp: new Date().toISOString(),
          };
        },
      });

      // And: the active JWKS key pair is loaded in KeyVault
      healthAdapter.registerProbe({
        name: 'keyvault',
        isCritical: true,
        timeoutMs: 1500,
        async check(): Promise<ProbeResult> {
          return {
            name: 'keyvault',
            status: 'OK',
            isCritical: true,
            latencyMs: 2.1,
            timestamp: new Date().toISOString(),
          };
        },
      });

      app = createApp({ healthCheckPort: healthAdapter });
    });

    it('should return HTTP 200 with status UP and all checks OK', async () => {
      // When: a probe request is made to "/health/ready"
      const response = await request(app).get('/health/ready');

      // Then: the response status code should be 200
      expect(response.status).toBe(200);

      // And: the response body should contain status "UP"
      expect(response.body.status).toBe('UP');

      // And: the database check should be "OK"
      const dbCheck = response.body.checks.database;
      const dbStatus = typeof dbCheck === 'object' ? dbCheck.status : dbCheck;
      expect(dbStatus).toBe('OK');

      // And: the keyvault check should be "OK"
      const kvCheck = response.body.checks.keyvault;
      const kvStatus = typeof kvCheck === 'object' ? kvCheck.status : kvCheck;
      expect(kvStatus).toBe('OK');
    });
  });

  describe('Scenario: Readiness probe returns 503 when PostgreSQL dependency is unavailable', () => {
    let healthAdapter: InMemoryHealthAdapter;
    let app: ReturnType<typeof createApp>;

    beforeEach(() => {
      healthAdapter = new InMemoryHealthAdapter();
      // Given: the PostgreSQL database connection is down or unreachable
      healthAdapter.registerProbe({
        name: 'database',
        isCritical: true,
        timeoutMs: 1500,
        async check(): Promise<ProbeResult> {
          return {
            name: 'database',
            status: 'DOWN',
            isCritical: true,
            reason: 'Connection terminated unexpectedly',
            latencyMs: 15.0,
            timestamp: new Date().toISOString(),
          };
        },
      });

      healthAdapter.registerProbe({
        name: 'keyvault',
        isCritical: true,
        timeoutMs: 1500,
        async check(): Promise<ProbeResult> {
          return {
            name: 'keyvault',
            status: 'OK',
            isCritical: true,
            latencyMs: 1.0,
            timestamp: new Date().toISOString(),
          };
        },
      });

      app = createApp({ healthCheckPort: healthAdapter });
    });

    it('should return HTTP 503 with status DOWN and database DOWN', async () => {
      // When: a probe request is made to "/health/ready"
      const response = await request(app).get('/health/ready');

      // Then: the response status code should be 503
      expect(response.status).toBe(503);

      // And: the response body should contain status "DOWN"
      expect(response.body.status).toBe('DOWN');

      // And: the database check should be "DOWN"
      const dbCheck = response.body.checks.database;
      const dbStatus = typeof dbCheck === 'object' ? dbCheck.status : dbCheck;
      expect(dbStatus).toBe('DOWN');
    });
  });

  describe('Scenario: Readiness probe fails fast on dependency timeout', () => {
    let healthAdapter: InMemoryHealthAdapter;
    let app: ReturnType<typeof createApp>;

    beforeEach(() => {
      healthAdapter = new InMemoryHealthAdapter();

      // Given: a critical dependency takes longer than 1500 milliseconds to respond
      const slowProbe: DependencyProbe = {
        name: 'database',
        isCritical: true,
        timeoutMs: 1000,
        async check(): Promise<ProbeResult> {
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 3000);
            if (timer.unref) {
              timer.unref();
            }
          });
          return {
            name: 'database',
            status: 'OK',
            isCritical: true,
            latencyMs: 3000,
            timestamp: new Date().toISOString(),
          };
        },
      };

      healthAdapter.registerProbe(slowProbe);
      app = createApp({ healthCheckPort: healthAdapter });
    });

    it('should abort within 1500 milliseconds and return HTTP 503 DOWN', async () => {
      const startTime = Date.now();

      // When: a probe request is made to "/health/ready"
      const response = await request(app).get('/health/ready');
      const durationMs = Date.now() - startTime;

      // Then: the probe should abort within 1500 milliseconds
      expect(durationMs).toBeLessThanOrEqual(1500);

      // And: the response status code should be 503
      expect(response.status).toBe(503);

      // And: the response body should contain status "DOWN"
      expect(response.body.status).toBe('DOWN');
      expect(response.body.checks.database.status).toBe('TIMEOUT');
    });
  });

  describe('Scenario: Aggregated health diagnostic endpoint exposes detailed dependency report', () => {
    let healthAdapter: InMemoryHealthAdapter;
    let app: ReturnType<typeof createApp>;

    beforeEach(() => {
      healthAdapter = new InMemoryHealthAdapter();
      // Given: the identity service is operational
      healthAdapter.registerProbe({
        name: 'database',
        isCritical: true,
        timeoutMs: 1500,
        async check(): Promise<ProbeResult> {
          return {
            name: 'database',
            status: 'OK',
            isCritical: true,
            latencyMs: 3.2,
            timestamp: new Date().toISOString(),
          };
        },
      });

      healthAdapter.registerProbe({
        name: 'cache',
        isCritical: false,
        timeoutMs: 1500,
        async check(): Promise<ProbeResult> {
          return {
            name: 'cache',
            status: 'OK',
            isCritical: false,
            latencyMs: 0.8,
            timestamp: new Date().toISOString(),
          };
        },
      });

      healthAdapter.registerProbe({
        name: 'keyvault',
        isCritical: true,
        timeoutMs: 1500,
        async check(): Promise<ProbeResult> {
          return {
            name: 'keyvault',
            status: 'OK',
            isCritical: true,
            latencyMs: 4.5,
            timestamp: new Date().toISOString(),
          };
        },
      });

      app = createApp({ healthCheckPort: healthAdapter });
    });

    it('should return HTTP 200 with overall status UP and individual latencies', async () => {
      // When: an operator sends a GET request to "/health"
      const response = await request(app).get('/health');

      // Then: the response status code should be 200
      expect(response.status).toBe(200);

      // And: the response body should contain overall status "UP"
      expect(response.body.status).toBe('UP');

      // And: the response body should include individual latencies for each probe
      expect(response.body.checks).toBeDefined();
      expect(response.body.checks.database.latencyMs).toBeDefined();
      expect(typeof response.body.checks.database.latencyMs).toBe('number');
      expect(response.body.checks.database.latencyMs).toBeGreaterThanOrEqual(0);

      expect(response.body.checks.cache.latencyMs).toBeDefined();
      expect(typeof response.body.checks.cache.latencyMs).toBe('number');
      expect(response.body.checks.cache.latencyMs).toBeGreaterThanOrEqual(0);

      expect(response.body.checks.keyvault.latencyMs).toBeDefined();
      expect(typeof response.body.checks.keyvault.latencyMs).toBe('number');
      expect(response.body.checks.keyvault.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });
});
