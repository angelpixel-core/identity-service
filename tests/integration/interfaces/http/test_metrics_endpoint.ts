import request from 'supertest';
import { createApp } from '../../../../interfaces/http/server';
import { InMemoryMetricsAdapter } from '../../../../src/contexts/shared/domain/telemetry/in_memory_metrics_adapter';
import { OpenTelemetryMetricsAdapter } from '../../../../src/contexts/shared/infrastructure/telemetry/opentelemetry_metrics_adapter';

describe('Integration API: Structured Metrics & Prometheus Endpoint (US-21)', () => {
  describe('Default In-Memory Metrics in Express Server', () => {
    let metricsAdapter: InMemoryMetricsAdapter;
    let app: ReturnType<typeof createApp>;

    beforeEach(() => {
      metricsAdapter = new InMemoryMetricsAdapter();
      app = createApp({ metricsAdapter });
    });

    it('should expose GET /metrics with status 200 and standard Prometheus exposition Content-Type', async () => {
      const response = await request(app).get('/metrics');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('text/plain; version=0.0.4; charset=utf-8');
    });

    it('should record inbound request traffic and latency after processing HTTP endpoints', async () => {
      // 1. Send legitimate traffic
      const healthRes = await request(app).get('/health');
      expect(healthRes.status).toBe(200);

      // 2. Query metrics endpoint
      const metricsRes = await request(app).get('/metrics');
      expect(metricsRes.status).toBe(200);
      expect(metricsRes.text).toContain('# HELP http_requests_total Total number of HTTP requests processed.');
      expect(metricsRes.text).toContain('# TYPE http_requests_total counter');
      expect(metricsRes.text).toContain('http_requests_total{method="GET",route="/health",status_code="200",tenant_id="none"} 1');
      expect(metricsRes.text).toContain('http_request_duration_seconds_count{method="GET",route="/health",status_code="200",tenant_id="none"} 1');
    });

    it('should record HTTP errors in http_errors_total when request fails with 4xx or 5xx', async () => {
      // 1. Send unauthorized request with valid tenant header to protected endpoint
      const unauthorizedRes = await request(app)
        .get('/api/v1/auth/me')
        .set('x-tenant-id', 'tenant-test');
      expect(unauthorizedRes.status).toBe(401);

      // 2. Query metrics endpoint
      const metricsRes = await request(app).get('/metrics');
      expect(metricsRes.status).toBe(200);
      expect(metricsRes.text).toContain('# HELP http_errors_total Total number of HTTP error responses.');
      expect(metricsRes.text).toContain('http_errors_total{method="GET",route="/api/v1/auth/me",status_code="401",error_type="UNAUTHORIZED",tenant_id="tenant-test"} 1');
    });

    it('should normalize parameterized and unmapped dynamic routes to prevent cardinality explosion', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';

      // 1. Parameterized Express route (/api/v1/users/:userId)
      const userRes = await request(app)
        .get(`/api/v1/users/${uuid}`)
        .set('x-tenant-id', 'tenant-alpha');
      expect(userRes.status).toBe(401);

      // 2. Unmapped route with UUID (404)
      const unmappedRes = await request(app)
        .get(`/api/v1/orders/${uuid}`)
        .set('x-tenant-id', 'tenant-alpha');
      expect(unmappedRes.status).toBe(404);

      const metricsRes = await request(app).get('/metrics');
      expect(metricsRes.status).toBe(200);

      // Express registered route should be parameterized
      expect(metricsRes.text).toContain('route="/api/v1/users/:userId"');
      // Unmapped route should be collapsed by RouteNormalizer to :id
      expect(metricsRes.text).toContain('route="/api/v1/orders/:id"');
      expect(metricsRes.text).toContain('tenant_id="tenant-alpha"');

      // The raw UUID must never leak in Prometheus labels
      expect(metricsRes.text).not.toContain(uuid);
    });
  });

  describe('Full OpenTelemetry SDK Integration in Express Server', () => {
    let otelAdapter: OpenTelemetryMetricsAdapter;
    let app: ReturnType<typeof createApp>;

    beforeEach(() => {
      otelAdapter = new OpenTelemetryMetricsAdapter();
      app = createApp({ metricsAdapter: otelAdapter });
    });

    afterEach(async () => {
      await otelAdapter.shutdown();
    });

    it('should export OpenTelemetry formatted metrics including runtime saturation and explicit histogram buckets', async () => {
      // 1. Trigger HTTP traffic
      await request(app).get('/health/live');

      // 2. Trigger an unauthenticated error with valid tenant header
      await request(app)
        .get('/api/v1/auth/me')
        .set('x-tenant-id', 'tenant-otel');

      // 3. Scrape /metrics
      const metricsRes = await request(app).get('/metrics');

      expect(metricsRes.status).toBe(200);
      expect(metricsRes.headers['content-type']).toBe('text/plain; version=0.0.4; charset=utf-8');

      // Golden Signal: Traffic
      expect(metricsRes.text).toContain('# HELP http_requests_total');
      expect(metricsRes.text).toContain('# TYPE http_requests_total counter');
      expect(metricsRes.text).toMatch(/http_requests_total\{[^}]*route="\/health\/live"[^}]*status_code="200"[^}]*\}\s+1/);

      // Golden Signal: Latency with explicit bucket boundaries
      expect(metricsRes.text).toContain('# HELP http_request_duration_seconds');
      expect(metricsRes.text).toContain('# TYPE http_request_duration_seconds histogram');
      expect(metricsRes.text).toContain('http_request_duration_seconds_bucket');
      expect(metricsRes.text).toMatch(/le="0\.05"/);
      expect(metricsRes.text).toMatch(/le="10"/);
      expect(metricsRes.text).toMatch(/le="\+Inf"/);

      // Golden Signal: Errors
      expect(metricsRes.text).toContain('# HELP http_errors_total');
      expect(metricsRes.text).toContain('# TYPE http_errors_total counter');
      expect(metricsRes.text).toMatch(/http_errors_total\{[^}]*route="\/api\/v1\/auth\/me"[^}]*status_code="401"[^}]*error_type="UNAUTHORIZED"[^}]*tenant_id="tenant-otel"[^}]*\}\s+1/);

      // Golden Signal: Runtime Saturation Gauges
      expect(metricsRes.text).toContain('# HELP process_memory_heap_bytes');
      expect(metricsRes.text).toContain('# TYPE process_memory_heap_bytes gauge');
      expect(metricsRes.text).toMatch(/process_memory_heap_bytes\{[^}]*\}\s+[1-9]\d*/);

      expect(metricsRes.text).toContain('# HELP nodejs_eventloop_lag_seconds');
      expect(metricsRes.text).toContain('# TYPE nodejs_eventloop_lag_seconds gauge');
    });
  });
});
