import request from 'supertest';
import { createApp } from '../../../../interfaces/http/server';

describe('Integration API: Health Probes & Reverse Proxy Support (US-13 & US-14)', () => {
  const app = createApp();

  describe('GET /health/live (Liveness Probe)', () => {
    it('should return HTTP 200 with status UP and liveness check OK', async () => {
      const response = await request(app).get('/health/live');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.body).toHaveProperty('status', 'UP');
      expect(response.body.checks).toHaveProperty('liveness', 'OK');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('protocol');
    });
  });

  describe('GET /health/ready (Readiness Probe)', () => {
    it('should return HTTP 200 with status UP and all dependency checks OK', async () => {
      const response = await request(app).get('/health/ready');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.body).toHaveProperty('status', 'UP');
      expect(response.body.checks).toHaveProperty('database', 'OK');
      expect(response.body.checks).toHaveProperty('cache', 'OK');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should return HTTP 503 with status DOWN when database connection fails, while keeping /health/live UP (US-14)', async () => {
      const degradedApp = createApp({
        dbHealthCheck: async () => {
          throw new Error('Connection terminated unexpectedly');
        },
      });

      const readyResponse = await request(degradedApp).get('/health/ready');
      expect(readyResponse.status).toBe(503);
      expect(readyResponse.body).toHaveProperty('status', 'DOWN');
      expect(readyResponse.body.checks).toEqual({
        database: 'DOWN',
        cache: 'OK',
      });

      const combinedResponse = await request(degradedApp).get('/health');
      expect(combinedResponse.status).toBe(503);
      expect(combinedResponse.body).toHaveProperty('status', 'DOWN');
      expect(combinedResponse.body.checks).toEqual({
        liveness: 'OK',
        database: 'DOWN',
        cache: 'OK',
      });

      // Liveness must remain 200 UP so K8s removes Pod from Service endpoints without restarting container
      const liveResponse = await request(degradedApp).get('/health/live');
      expect(liveResponse.status).toBe(200);
      expect(liveResponse.body).toHaveProperty('status', 'UP');
      expect(liveResponse.body.checks).toHaveProperty('liveness', 'OK');
    });

    it('should return HTTP 503 with status DOWN when cache dependency is unreachable (US-14)', async () => {
      const degradedCacheApp = createApp({
        cacheHealthCheck: async () => false,
      });

      const readyResponse = await request(degradedCacheApp).get('/health/ready');
      expect(readyResponse.status).toBe(503);
      expect(readyResponse.body).toHaveProperty('status', 'DOWN');
      expect(readyResponse.body.checks).toEqual({
        database: 'OK',
        cache: 'DOWN',
      });
    });
  });

  describe('GET /health (Combined Health Endpoint)', () => {
    it('should return HTTP 200 with combined diagnostic status', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.body).toHaveProperty('status', 'UP');
      expect(response.body.checks).toHaveProperty('liveness', 'OK');
      expect(response.body.checks).toHaveProperty('database', 'OK');
      expect(response.body.checks).toHaveProperty('cache', 'OK');
    });
  });

  describe('Reverse Proxy Trust & Header Forwarding (trust proxy)', () => {
    it('should recognize https protocol when X-Forwarded-Proto is set to https', async () => {
      const response = await request(app)
        .get('/health/live')
        .set('X-Forwarded-Proto', 'https')
        .set('X-Forwarded-Host', 'auth.angelpixel.local');

      expect(response.status).toBe(200);
      expect(response.body.protocol).toBe('https');
    });

    it('should preserve and reflect client-provided X-Request-ID header in response', async () => {
      const customRequestId = 'test-trace-id-abc-12345';
      const response = await request(app)
        .get('/health/live')
        .set('X-Request-ID', customRequestId);

      expect(response.status).toBe(200);
      expect(response.headers['x-request-id']).toBe(customRequestId);
    });

    it('should auto-generate a valid UUIDv4 X-Request-ID header when not provided by client', async () => {
      const response = await request(app).get('/health/live');

      expect(response.status).toBe(200);
      const generatedId = response.headers['x-request-id'];
      expect(generatedId).toBeDefined();
      // UUID format validation: 8-4-4-4-12 hex digits
      expect(generatedId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });
  });
});
