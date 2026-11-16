import request from 'supertest';
import { createApp } from '../../../interfaces/http/server';
import { InMemoryMetricsAdapter } from '../../../src/contexts/shared/domain/telemetry/in_memory_metrics_adapter';
import { OpenTelemetryMetricsAdapter } from '../../../src/contexts/shared/infrastructure/telemetry/opentelemetry_metrics_adapter';

describe('Feature: OpenTelemetry SDK Integration & Structured Metrics (Golden Signals - US-21)', () => {
  describe('Scenario: Exposición del endpoint de métricas Prometheus con Content-Type canónico', () => {
    let metricsAdapter: InMemoryMetricsAdapter;
    let app: ReturnType<typeof createApp>;

    beforeEach(() => {
      metricsAdapter = new InMemoryMetricsAdapter();
      app = createApp({ metricsAdapter });
    });

    it('debe responder HTTP 200 con Content-Type canónico de Prometheus', async () => {
      // Given: un servidor HTTP identity-service en ejecución (app)
      // When: un agente de telemetría solicita GET /metrics
      const response = await request(app).get('/metrics');

      // Then: la respuesta tiene status 200 OK
      expect(response.status).toBe(200);

      // And: el Content-Type es text/plain; version=0.0.4; charset=utf-8
      expect(response.headers['content-type']).toBe('text/plain; version=0.0.4; charset=utf-8');
    });
  });

  describe('Scenario: Monitoreo de Golden Signals de Tráfico y Latencia', () => {
    let metricsAdapter: InMemoryMetricsAdapter;
    let app: ReturnType<typeof createApp>;

    beforeEach(() => {
      metricsAdapter = new InMemoryMetricsAdapter();
      app = createApp({ metricsAdapter });
    });

    it('debe registrar el contador de tráfico y el histograma de latencia', async () => {
      // Given: una petición legítima procesada por el servidor
      const healthRes = await request(app).get('/health/live');
      expect(healthRes.status).toBe(200);

      // When: se consulta el endpoint /metrics
      const metricsRes = await request(app).get('/metrics');
      expect(metricsRes.status).toBe(200);

      // Then: el contador http_requests_total refleja la petición procesada
      expect(metricsRes.text).toContain('# TYPE http_requests_total counter');
      expect(metricsRes.text).toContain('http_requests_total{method="GET",route="/health/live",status_code="200",tenant_id="none"} 1');

      // And: el histograma http_request_duration_seconds registra la latencia con buckets SRE
      expect(metricsRes.text).toContain('# TYPE http_request_duration_seconds histogram');
      expect(metricsRes.text).toContain('http_request_duration_seconds_count{method="GET",route="/health/live",status_code="200",tenant_id="none"} 1');
      expect(metricsRes.text).toContain('http_request_duration_seconds_sum{method="GET",route="/health/live",status_code="200",tenant_id="none"}');
    });
  });

  describe('Scenario: Monitoreo de Golden Signals de Errores HTTP', () => {
    let metricsAdapter: InMemoryMetricsAdapter;
    let app: ReturnType<typeof createApp>;

    beforeEach(() => {
      metricsAdapter = new InMemoryMetricsAdapter();
      app = createApp({ metricsAdapter });
    });

    it('debe registrar http_errors_total ante peticiones fallidas 4xx o 5xx', async () => {
      // Given: una petición que falla con error 4xx o 5xx (acceso sin credenciales a endpoint protegido)
      const errorRes = await request(app)
        .get('/api/v1/auth/me')
        .set('x-tenant-id', 'tenant-bdd');
      expect(errorRes.status).toBe(401);

      // When: se consulta el endpoint /metrics
      const metricsRes = await request(app).get('/metrics');
      expect(metricsRes.status).toBe(200);

      // Then: el contador http_errors_total se incrementa con el error_type y status_code correspondientes
      expect(metricsRes.text).toContain('# TYPE http_errors_total counter');
      expect(metricsRes.text).toContain('http_errors_total{method="GET",route="/api/v1/auth/me",status_code="401",error_type="UNAUTHORIZED",tenant_id="tenant-bdd"} 1');
    });
  });

  describe('Scenario: Prevención de explosión de cardinalidad en rutas dinámicas', () => {
    let metricsAdapter: InMemoryMetricsAdapter;
    let app: ReturnType<typeof createApp>;

    beforeEach(() => {
      metricsAdapter = new InMemoryMetricsAdapter();
      app = createApp({ metricsAdapter });
    });

    it('debe colapsar rutas dinámicas y parámetros UUID en etiquetas estables', async () => {
      // Given: peticiones enviadas a rutas con UUIDs y parámetros dinámicos
      const dynamicUuid = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
      const userRes = await request(app)
        .get(`/api/v1/users/${dynamicUuid}`)
        .set('x-tenant-id', 'tenant-cardinality');
      expect(userRes.status).toBe(401);

      const unmappedRes = await request(app)
        .get(`/api/v1/invoices/${dynamicUuid}`)
        .set('x-tenant-id', 'tenant-cardinality');
      expect(unmappedRes.status).toBe(404);

      // When: se consulta el endpoint /metrics
      const metricsRes = await request(app).get('/metrics');
      expect(metricsRes.status).toBe(200);

      // Then: las etiquetas route se exponen normalizadas y colapsadas sin filtrar identificadores únicos
      expect(metricsRes.text).toContain('route="/api/v1/users/:userId"');
      expect(metricsRes.text).toContain('route="/api/v1/invoices/:id"');
      expect(metricsRes.text).toContain('tenant_id="tenant-cardinality"');
      expect(metricsRes.text).not.toContain(dynamicUuid);
    });
  });

  describe('Scenario: Monitoreo de Saturación de Runtime Node.js', () => {
    let otelAdapter: OpenTelemetryMetricsAdapter;
    let app: ReturnType<typeof createApp>;

    beforeEach(() => {
      otelAdapter = new OpenTelemetryMetricsAdapter();
      app = createApp({ metricsAdapter: otelAdapter });
    });

    afterEach(async () => {
      await otelAdapter.shutdown();
    });

    it('debe reportar medidores de memoria heap y retardo del event loop', async () => {
      // Given: el servicio operando con el SDK de OpenTelemetry
      await request(app).get('/health/live');

      // When: se consulta el endpoint /metrics
      const metricsRes = await request(app).get('/metrics');
      expect(metricsRes.status).toBe(200);

      // Then: se reporta el medidor process_memory_heap_bytes con el uso de memoria heap
      expect(metricsRes.text).toContain('# HELP process_memory_heap_bytes');
      expect(metricsRes.text).toContain('# TYPE process_memory_heap_bytes gauge');
      expect(metricsRes.text).toMatch(/process_memory_heap_bytes\{[^}]*\}\s+[1-9]\d*/);

      // And: se reporta el medidor nodejs_eventloop_lag_seconds con la latencia del event loop
      expect(metricsRes.text).toContain('# HELP nodejs_eventloop_lag_seconds');
      expect(metricsRes.text).toContain('# TYPE nodejs_eventloop_lag_seconds gauge');
      expect(metricsRes.text).toMatch(/nodejs_eventloop_lag_seconds\{[^}]*\}\s+\d+/);

      // And: los buckets explícitos de histograma SRE están presentes
      expect(metricsRes.text).toContain('http_request_duration_seconds_bucket');
      expect(metricsRes.text).toMatch(/le="0\.005"/);
      expect(metricsRes.text).toMatch(/le="10"/);
      expect(metricsRes.text).toMatch(/le="\+Inf"/);
    });
  });
});
