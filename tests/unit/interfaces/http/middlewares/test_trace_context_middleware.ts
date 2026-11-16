import { Request, Response, NextFunction } from 'express';
import { traceContextMiddleware } from '../../../../../interfaces/http/middlewares/trace_context_middleware';
import { CorrelationContextStorage } from '../../../../../src/contexts/shared/infrastructure/tracing/correlation_context_storage';

describe('HTTP Middleware: traceContextMiddleware (W3C & RFC 7230 Tracing)', () => {
  const validTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
  const incomingParentSpanId = '00f067aa0ba902b7';
  const validTraceparent = `00-${validTraceId}-${incomingParentSpanId}-01`;

  const createMockResponse = () => {
    const headers: Record<string, string> = {};
    const res: any = {};
    res.setHeader = jest.fn((key: string, value: string) => {
      headers[key.toLowerCase()] = value;
      return res;
    });
    res.getHeader = jest.fn((key: string) => headers[key.toLowerCase()]);
    res._headers = headers;
    return res as Response & { _headers: Record<string, string> };
  };

  afterEach(() => {
    // Garantizar que no queden residuos en el almacenamiento asíncrono
    expect(CorrelationContextStorage.current()).toBeUndefined();
  });

  describe('Peticiones con cabeceras W3C válidas', () => {
    it('debe preservar traceId, derivar un nuevo child spanId y propagar el contexto en AsyncLocalStorage', (done) => {
      const req = {
        headers: {
          traceparent: validTraceparent,
          'x-request-id': 'custom-req-123',
        },
      } as unknown as Request;
      const res = createMockResponse();

      const next: NextFunction = jest.fn(() => {
        // Dentro de next() el contexto debe estar activo en CorrelationContextStorage
        const activeContext = CorrelationContextStorage.current();
        expect(activeContext).toBeDefined();
        expect(activeContext?.traceId).toBe(validTraceId);
        expect(activeContext?.parentSpanId).toBe(incomingParentSpanId);
        expect(activeContext?.spanId).toMatch(/^[0-9a-f]{16}$/);
        expect(activeContext?.spanId).not.toBe(incomingParentSpanId);
        expect(activeContext?.requestId).toBe('custom-req-123');

        // req.traceContext debe estar inyectado
        expect(req.traceContext).toBe(activeContext);
        expect(req.headers['x-request-id']).toBe('custom-req-123');
        expect(req.headers['x-correlation-id']).toBe('custom-req-123');

        // Las cabeceras de respuesta deben coincidir
        expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'custom-req-123');
        expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', 'custom-req-123');
        expect(res.setHeader).toHaveBeenCalledWith('traceparent', activeContext?.toTraceparent());

        done();
      });

      traceContextMiddleware(req, res, next);
    });
  });

  describe('Peticiones huérfanas (sin cabeceras de traza)', () => {
    it('debe generar una nueva raíz de traza y un UUID v4 para requestId', (done) => {
      const req = {
        headers: {},
      } as unknown as Request;
      const res = createMockResponse();

      const next: NextFunction = jest.fn(() => {
        const activeContext = CorrelationContextStorage.current();
        expect(activeContext).toBeDefined();
        expect(activeContext?.version).toBe('00');
        expect(activeContext?.traceId).toMatch(/^[0-9a-f]{32}$/);
        expect(activeContext?.traceId).not.toBe('00000000000000000000000000000000');
        expect(activeContext?.spanId).toMatch(/^[0-9a-f]{16}$/);
        expect(activeContext?.spanId).not.toBe('0000000000000000');
        expect(activeContext?.parentSpanId).toBeUndefined();
        expect(activeContext?.requestId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        );

        expect(req.traceContext).toBe(activeContext);
        expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', activeContext?.requestId);
        expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', activeContext?.requestId);
        expect(res.setHeader).toHaveBeenCalledWith('traceparent', activeContext?.toTraceparent());

        done();
      });

      traceContextMiddleware(req, res, next);
    });
  });

  describe('Peticiones con cabeceras corruptas o malformadas', () => {
    it('debe actuar defensivamente generando una nueva raíz de traza sin interrumpir la petición', (done) => {
      const req = {
        headers: {
          traceparent: 'malformed-traceparent-value',
        },
      } as unknown as Request;
      const res = createMockResponse();

      const next: NextFunction = jest.fn(() => {
        const activeContext = CorrelationContextStorage.current();
        expect(activeContext).toBeDefined();
        expect(activeContext?.traceId).toMatch(/^[0-9a-f]{32}$/);
        expect(activeContext?.parentSpanId).toBeUndefined();

        expect(res.setHeader).toHaveBeenCalledWith('traceparent', activeContext?.toTraceparent());
        expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', activeContext?.requestId);

        done();
      });

      traceContextMiddleware(req, res, next);
    });

    it('debe actuar defensivamente si traceparent contiene versión no soportada o ceros totales', (done) => {
      const req = {
        headers: {
          traceparent: '01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        },
      } as unknown as Request;
      const res = createMockResponse();

      const next: NextFunction = jest.fn(() => {
        const activeContext = CorrelationContextStorage.current();
        expect(activeContext).toBeDefined();
        expect(activeContext?.version).toBe('00');
        expect(activeContext?.traceId).not.toBe('4bf92f3577b34da6a3ce929d0e0e4736');

        done();
      });

      traceContextMiddleware(req, res, next);
    });
  });
});
