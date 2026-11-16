import { EventEmitter } from 'events';
import { Request, Response, NextFunction } from 'express';
import { createMetricsMiddleware } from '../../../../../src/contexts/shared/infrastructure/telemetry/metrics_middleware';
import { InMemoryMetricsAdapter } from '../../../../../src/contexts/shared/domain/telemetry/in_memory_metrics_adapter';

describe('createMetricsMiddleware (US-21 HTTP Telemetry)', () => {
  let metricsAdapter: InMemoryMetricsAdapter;

  beforeEach(() => {
    metricsAdapter = new InMemoryMetricsAdapter();
  });

  const createMockReqRes = (options: {
    method?: string;
    path?: string;
    baseUrl?: string;
    routePath?: string;
    statusCode?: number;
    tenantId?: string;
    headerTenantId?: string;
    locals?: Record<string, unknown>;
  }) => {
    const req = {
      method: options.method || 'GET',
      path: options.path || '/api/v1/users',
      baseUrl: options.baseUrl || '',
      route: options.routePath ? { path: options.routePath } : undefined,
      headers: {
        ...(options.headerTenantId ? { 'x-tenant-id': options.headerTenantId } : {}),
      },
      tenantId: options.tenantId,
    } as unknown as Request;

    const resEmitter = new EventEmitter();
    const res = Object.assign(resEmitter, {
      statusCode: options.statusCode || 200,
      locals: options.locals || {},
    }) as unknown as Response;

    const next = jest.fn() as NextFunction;

    return { req, res, next, resEmitter };
  };

  it('should call next() and record HTTP traffic and latency on response finish', async () => {
    const recordSpy = jest.spyOn(metricsAdapter, 'recordHttpRequest');
    const middleware = createMetricsMiddleware(metricsAdapter);
    const { req, res, next, resEmitter } = createMockReqRes({
      method: 'GET',
      path: '/api/v1/users',
      statusCode: 200,
      tenantId: 'tenant-prod',
    });

    middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    resEmitter.emit('finish');

    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        method: 'GET',
        route: '/api/v1/users',
        statusCode: 200,
        tenantId: 'tenant-prod',
      })
    );

    const metrics = await metricsAdapter.getMetrics();
    expect(metrics).toContain('http_requests_total{method="GET",route="/api/v1/users",status_code="200",tenant_id="tenant-prod"} 1');
  });

  it('should normalize dynamic routes and collapse IDs to prevent cardinality explosion', async () => {
    const recordSpy = jest.spyOn(metricsAdapter, 'recordHttpRequest');
    const middleware = createMetricsMiddleware(metricsAdapter);
    const { req, res, next, resEmitter } = createMockReqRes({
      method: 'GET',
      baseUrl: '/api/v1',
      path: '/users/550e8400-e29b-41d4-a716-446655440000',
    });

    middleware(req, res, next);
    resEmitter.emit('finish');

    expect(recordSpy).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        route: '/api/v1/users/:id',
      })
    );
  });

  it('should record HTTP errors when statusCode >= 400 with inferred error type', async () => {
    const errorSpy = jest.spyOn(metricsAdapter, 'recordHttpError');
    const middleware = createMetricsMiddleware(metricsAdapter);
    const { req, res, next, resEmitter } = createMockReqRes({
      method: 'POST',
      path: '/api/v1/auth/login',
      statusCode: 401,
    });

    middleware(req, res, next);
    resEmitter.emit('finish');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        route: '/api/v1/auth/login',
        statusCode: 401,
        errorType: 'UNAUTHORIZED',
      })
    );

    const metrics = await metricsAdapter.getMetrics();
    expect(metrics).toContain('error_type="UNAUTHORIZED"');
  });

  it('should use custom errorType from res.locals when provided', async () => {
    const errorSpy = jest.spyOn(metricsAdapter, 'recordHttpError');
    const middleware = createMetricsMiddleware(metricsAdapter);
    const { req, res, next, resEmitter } = createMockReqRes({
      method: 'POST',
      path: '/api/v1/auth/token',
      statusCode: 400,
      locals: {
        errorType: 'INVALID_GRANT',
      },
    });

    middleware(req, res, next);
    resEmitter.emit('finish');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        errorType: 'INVALID_GRANT',
      })
    );
  });

  it('should map 5xx status codes to INTERNAL_SERVER_ERROR by default', async () => {
    const errorSpy = jest.spyOn(metricsAdapter, 'recordHttpError');
    const middleware = createMetricsMiddleware(metricsAdapter);
    const { req, res, next, resEmitter } = createMockReqRes({
      method: 'GET',
      path: '/api/v1/data',
      statusCode: 503,
    });

    middleware(req, res, next);
    resEmitter.emit('finish');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        errorType: 'INTERNAL_SERVER_ERROR',
      })
    );
  });

  it('should extract tenantId from header x-tenant-id when req.tenantId is absent', async () => {
    const recordSpy = jest.spyOn(metricsAdapter, 'recordHttpRequest');
    const middleware = createMetricsMiddleware(metricsAdapter);
    const { req, res, next, resEmitter } = createMockReqRes({
      method: 'GET',
      path: '/api/v1/status',
      headerTenantId: 'tenant-header',
    });

    middleware(req, res, next);
    resEmitter.emit('finish');

    expect(recordSpy).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        tenantId: 'tenant-header',
      })
    );
  });

  it('should be idempotent and not record duplicate metrics if finish and close both fire', () => {
    const recordSpy = jest.spyOn(metricsAdapter, 'recordHttpRequest');
    const middleware = createMetricsMiddleware(metricsAdapter);
    const { req, res, next, resEmitter } = createMockReqRes({
      method: 'GET',
      path: '/api/v1/health',
      statusCode: 200,
    });

    middleware(req, res, next);
    resEmitter.emit('finish');
    resEmitter.emit('close');

    expect(recordSpy).toHaveBeenCalledTimes(1);
  });
});
