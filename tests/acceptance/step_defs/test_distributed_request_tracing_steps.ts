import http from 'http';
import request from 'supertest';
import { Express } from 'express';
import { createApp } from '../../../interfaces/http/server';
import { TenantAwareTransactionRunner } from '../../../src/contexts/identity/infrastructure/persistence/database/tenant_aware_transaction_runner';
import { CorrelationContextStorage } from '../../../src/contexts/shared/infrastructure/tracing/correlation_context_storage';
import { DatabaseClient } from '../../../src/contexts/identity/infrastructure/persistence/repositories/user/repository';

interface MockPoolClient extends DatabaseClient {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
  release: jest.Mock;
}

interface MockConnectionPool {
  connect: jest.Mock<Promise<MockPoolClient>, []>;
}

describe('Feature: Distributed Request Tracing and W3C Trace Context Propagation (US-20)', () => {
  let app: Express;
  let server: http.Server;
  let mockClient: MockPoolClient;
  let mockPool: MockConnectionPool;
  let executedDbQueries: Array<{ sql: string; params?: any[] }>;

  beforeEach((done) => {
    executedDbQueries = [];

    mockClient = {
      query: jest.fn().mockImplementation(async (sql: string, params?: any[]) => {
        executedDbQueries.push({ sql, params });
        return { rows: [] };
      }),
      release: jest.fn(),
    };

    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
    };

    const txRunner = new TenantAwareTransactionRunner(mockPool as any);

    app = createApp();

    // Endpoint de prueba para verificar acceso a AsyncLocalStorage y ejecución de transacciones en BD
    app.get('/api/v1/test/trace-probe', async (_req, res) => {
      const activeContext = CorrelationContextStorage.current();
      let txResult = null;

      if (activeContext) {
        txResult = await txRunner.runInTenantContext('tenant-bdd-demo', async () => {
          return 'tx-executed-within-trace';
        });
      }

      res.status(200).json({
        hasActiveContext: !!activeContext,
        traceId: activeContext?.traceId,
        spanId: activeContext?.spanId,
        parentSpanId: activeContext?.parentSpanId,
        requestId: activeContext?.requestId,
        txResult,
      });
    });

    server = http.createServer(app);
    server.listen(0, done);
  });

  afterEach((done) => {
    if (server) {
      server.closeAllConnections?.();
      server.close(done);
    } else {
      done();
    }
  });

  describe('Scenario 1: Propagación de traza W3C existente con derivación de nuevo span', () => {
    it('debe preservar trace_id, generar un nuevo child span_id y propagar en AsyncLocalStorage', async () => {
      // Given una petición entrante con cabecera "traceparent" válida y "X-Request-ID"
      const incomingTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
      const incomingSpanId = '00f067aa0ba902b7';
      const incomingTraceparent = `00-${incomingTraceId}-${incomingSpanId}-01`;
      const incomingRequestId = 'req-legit-uuid-1234';

      // When el TraceContextMiddleware procesa la solicitud
      const res = await request(server)
        .get('/api/v1/test/trace-probe')
        .set('traceparent', incomingTraceparent)
        .set('X-Request-ID', incomingRequestId);

      // Then la respuesta HTTP contiene el header "X-Request-ID" con "req-legit-uuid-1234"
      expect(res.status).toBe(200);
      expect(res.headers['x-request-id']).toBe(incomingRequestId);

      // And la respuesta HTTP contiene un header "traceparent" con el mismo trace_id
      const outgoingTraceparent = res.headers['traceparent'] as string;
      expect(outgoingTraceparent).toBeDefined();
      expect(outgoingTraceparent).toMatch(
        new RegExp(`^00-${incomingTraceId}-[0-9a-f]{16}-01$`)
      );

      // And el span_id en la respuesta es diferente del span entrante "00f067aa0ba902b7"
      const spanMatch = outgoingTraceparent.match(/^00-[0-9a-f]{32}-([0-9a-f]{16})-01$/);
      expect(spanMatch).not.toBeNull();
      const outgoingSpanId = spanMatch![1];
      expect(outgoingSpanId).not.toBe(incomingSpanId);

      // And el contexto está disponible en AsyncLocalStorage
      expect(res.body.hasActiveContext).toBe(true);
      expect(res.body.traceId).toBe(incomingTraceId);
      expect(res.body.parentSpanId).toBe(incomingSpanId);
      expect(res.body.spanId).toBe(outgoingSpanId);
      expect(res.body.requestId).toBe(incomingRequestId);
    });
  });

  describe('Scenario 2: Generación automática de traza W3C ante petición huérfana de headers', () => {
    it('debe generar un nuevo X-Request-ID UUID v4 y una nueva traza W3C versión 00 válida', async () => {
      // Given una petición entrante sin cabeceras de trazabilidad
      // When la petición es recibida por el servidor HTTP
      const res = await request(server).get('/health/live');

      // Then se genera un nuevo "X-Request-ID" en formato UUID v4
      expect(res.status).toBe(200);
      const outgoingRequestId = res.headers['x-request-id'];
      expect(outgoingRequestId).toBeDefined();
      expect(outgoingRequestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );

      // And se genera un nuevo "traceparent" W3C versión "00" válido
      const outgoingTraceparent = res.headers['traceparent'];
      expect(outgoingTraceparent).toBeDefined();
      expect(outgoingTraceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
      expect(outgoingTraceparent).not.toContain('00000000000000000000000000000000');
      expect(outgoingTraceparent).not.toContain('0000000000000000');

      // And ambos identificadores se retornan en las cabeceras de la respuesta
      expect(res.headers['x-correlation-id']).toBe(outgoingRequestId);
    });
  });

  describe('Scenario 3: Manejo defensivo ante cabecera traceparent malformada', () => {
    it('debe descartar la cabecera corrupta sin error 500 y generar una nueva traza legítima', async () => {
      // Given una petición entrante con "traceparent" inválido "invalid-trace-header"
      // When el TraceContextMiddleware valida la cabecera
      const res = await request(server)
        .get('/health/live')
        .set('traceparent', 'invalid-trace-header');

      // Then la cabecera corrupta es descartada sin provocar error 500
      expect(res.status).toBe(200);

      // And se genera una nueva traza W3C legítima retornada en la respuesta
      const outgoingTraceparent = res.headers['traceparent'];
      expect(outgoingTraceparent).toBeDefined();
      expect(outgoingTraceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
      expect(res.headers['x-request-id']).toBeDefined();
    });
  });

  describe('Scenario 4: Propagación de contexto de traza a PostgreSQL dentro de transacción', () => {
    it('debe ejecutar sentencias SET LOCAL app.traceparent y SET LOCAL app.request_id con los valores activos', async () => {
      // Given una petición HTTP procesada dentro de un contexto de traza activo
      const traceId = '7af92f3577b34da6a3ce929d0e0e4736';
      const spanId = '11f067aa0ba902b7';
      const requestId = 'req-bdd-tx-postgres-99';

      // When el TenantAwareTransactionRunner inicia una transacción en base de datos
      const res = await request(server)
        .get('/api/v1/test/trace-probe')
        .set('traceparent', `00-${traceId}-${spanId}-01`)
        .set('X-Request-ID', requestId);

      expect(res.status).toBe(200);
      expect(res.body.txResult).toBe('tx-executed-within-trace');

      // Then se ejecutan las sentencias "SET LOCAL app.traceparent" y "SET LOCAL app.request_id"
      const setTraceparentQuery = executedDbQueries.find((q) =>
        q.sql.includes("'app.traceparent'")
      );
      const setRequestIdQuery = executedDbQueries.find((q) =>
        q.sql.includes("'app.request_id'")
      );
      const setTenantQuery = executedDbQueries.find((q) =>
        q.sql.includes("'app.current_tenant_id'")
      );

      expect(setTenantQuery).toBeDefined();
      expect(setTraceparentQuery).toBeDefined();
      expect(setRequestIdQuery).toBeDefined();

      // And los valores coinciden con el contexto activo de la petición
      expect(setTenantQuery?.params?.[0]).toBe('tenant-bdd-demo');
      expect(setTraceparentQuery?.params?.[0]).toMatch(
        new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`)
      );
      expect(setRequestIdQuery?.params?.[0]).toBe(requestId);
    });
  });
});
