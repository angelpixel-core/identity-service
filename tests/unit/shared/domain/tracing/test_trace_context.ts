import { TraceContext, InvalidTraceContextError } from '../../../../../src/contexts/shared/domain/tracing/trace_context';

describe('Value Object: TraceContext (W3C Trace Context Specification)', () => {
  const validTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
  const validSpanId = '00f067aa0ba902b7';
  const validFlags = '01';
  const validRequestId = '550e8400-e29b-41d4-a716-446655440000';

  describe('Instanciación Válida y Creación Segura', () => {
    it('debe crear una instancia válida de TraceContext con valores explícitos', () => {
      const context = TraceContext.create({
        traceId: validTraceId,
        spanId: validSpanId,
        traceFlags: validFlags,
        requestId: validRequestId,
      });

      expect(context.version).toBe('00');
      expect(context.traceId).toBe(validTraceId);
      expect(context.spanId).toBe(validSpanId);
      expect(context.traceFlags).toBe('01');
      expect(context.requestId).toBe(validRequestId);
      expect(context.parentSpanId).toBeUndefined();
    });

    it('debe generar una nueva raíz de traza con TraceContext.createNew()', () => {
      const context = TraceContext.createNew();

      expect(context.version).toBe('00');
      expect(context.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(context.traceId).not.toBe('00000000000000000000000000000000');
      expect(context.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(context.spanId).not.toBe('0000000000000000');
      expect(context.traceFlags).toBe('01');
      expect(context.requestId).toBeDefined();
      expect(context.requestId.length).toBeGreaterThan(0);
      expect(context.parentSpanId).toBeUndefined();
    });

    it('debe respetar el requestId suministrado en TraceContext.createNew(customRequestId)', () => {
      const customReqId = 'req-custom-999';
      const context = TraceContext.createNew(customReqId);

      expect(context.requestId).toBe(customReqId);
    });

    it('debe serializar al formato W3C traceparent canónico', () => {
      const context = TraceContext.create({
        traceId: validTraceId,
        spanId: validSpanId,
        traceFlags: '01',
        requestId: validRequestId,
      });

      expect(context.toTraceparent()).toBe(`00-${validTraceId}-${validSpanId}-01`);
    });
  });

  describe('Parseo W3C Traceparent y Derivación de Spans', () => {
    it('debe parsear un header W3C válido, preservar traceId y derivar un nuevo child spanId', () => {
      const incomingTraceparent = `00-${validTraceId}-${validSpanId}-01`;
      const context = TraceContext.fromW3C(incomingTraceparent, validRequestId);

      expect(context.version).toBe('00');
      expect(context.traceId).toBe(validTraceId);
      // El span actual del servicio debe ser nuevo (hop derivado)
      expect(context.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(context.spanId).not.toBe(validSpanId);
      // El span entrante se preserva como parentSpanId
      expect(context.parentSpanId).toBe(validSpanId);
      expect(context.traceFlags).toBe('01');
      expect(context.requestId).toBe(validRequestId);
    });

    it('debe generar un requestId UUID si no se suministra uno al parsear fromW3C', () => {
      const incomingTraceparent = `00-${validTraceId}-${validSpanId}-01`;
      const context = TraceContext.fromW3C(incomingTraceparent);

      expect(context.requestId).toBeDefined();
      expect(context.requestId.length).toBeGreaterThan(0);
    });

    it('debe validar cabeceras con isValidW3C sin lanzar excepciones', () => {
      expect(TraceContext.isValidW3C(`00-${validTraceId}-${validSpanId}-01`)).toBe(true);
      expect(TraceContext.isValidW3C('invalid-header')).toBe(false);
      expect(TraceContext.isValidW3C(`01-${validTraceId}-${validSpanId}-01`)).toBe(false);
      expect(TraceContext.isValidW3C(`00-00000000000000000000000000000000-${validSpanId}-01`)).toBe(false);
    });

    it('debe derivar un child span explícito con createChildSpan()', () => {
      const root = TraceContext.createNew('req-1');
      const child = root.createChildSpan();

      expect(child.traceId).toBe(root.traceId);
      expect(child.traceFlags).toBe(root.traceFlags);
      expect(child.requestId).toBe(root.requestId);
      expect(child.parentSpanId).toBe(root.spanId);
      expect(child.spanId).not.toBe(root.spanId);
      expect(child.spanId).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  describe('Validación Defensiva de Invariantes W3C (Casos de Rechazo)', () => {
    it('debe rechazar versiones distintas de "00"', () => {
      expect(() => {
        TraceContext.fromW3C(`01-${validTraceId}-${validSpanId}-01`);
      }).toThrow(InvalidTraceContextError);

      expect(() => {
        TraceContext.fromW3C(`ff-${validTraceId}-${validSpanId}-01`);
      }).toThrow(InvalidTraceContextError);
    });

    it('debe rechazar traceId inválido (no hex o longitud distinta de 32)', () => {
      expect(() => {
        TraceContext.create({
          traceId: 'short',
          spanId: validSpanId,
        });
      }).toThrow(InvalidTraceContextError);

      expect(() => {
        TraceContext.create({
          traceId: '4bf92f3577b34da6a3ce929d0e0e473g', // 'g' no es hex
          spanId: validSpanId,
        });
      }).toThrow(InvalidTraceContextError);
    });

    it('debe rechazar traceId de solo ceros (All-Zeroes Trace ID)', () => {
      const allZeroesTraceId = '00000000000000000000000000000000';
      expect(() => {
        TraceContext.create({
          traceId: allZeroesTraceId,
          spanId: validSpanId,
        });
      }).toThrow(InvalidTraceContextError);

      expect(() => {
        TraceContext.fromW3C(`00-${allZeroesTraceId}-${validSpanId}-01`);
      }).toThrow(InvalidTraceContextError);
    });

    it('debe rechazar spanId inválido (no hex o longitud distinta de 16)', () => {
      expect(() => {
        TraceContext.create({
          traceId: validTraceId,
          spanId: '1234',
        });
      }).toThrow(InvalidTraceContextError);

      expect(() => {
        TraceContext.create({
          traceId: validTraceId,
          spanId: '00f067aa0ba902bz', // 'z' no es hex
        });
      }).toThrow(InvalidTraceContextError);
    });

    it('debe rechazar spanId de solo ceros (All-Zeroes Span ID)', () => {
      const allZeroesSpanId = '0000000000000000';
      expect(() => {
        TraceContext.create({
          traceId: validTraceId,
          spanId: allZeroesSpanId,
        });
      }).toThrow(InvalidTraceContextError);

      expect(() => {
        TraceContext.fromW3C(`00-${validTraceId}-${allZeroesSpanId}-01`);
      }).toThrow(InvalidTraceContextError);
    });

    it('debe rechazar flags inválidas (no hex de 2 caracteres)', () => {
      expect(() => {
        TraceContext.create({
          traceId: validTraceId,
          spanId: validSpanId,
          traceFlags: 'xyz',
        });
      }).toThrow(InvalidTraceContextError);
    });

    it('debe rechazar cabeceras con formato truncado o malformado', () => {
      expect(() => TraceContext.fromW3C('')).toThrow(InvalidTraceContextError);
      expect(() => TraceContext.fromW3C('not-a-traceparent')).toThrow(InvalidTraceContextError);
      expect(() => TraceContext.fromW3C(`00-${validTraceId}`)).toThrow(InvalidTraceContextError);
    });
  });

  describe('Igualdad de Valor (Value Object Inmutability)', () => {
    it('debe retornar true si dos instancias tienen idénticos atributos', () => {
      const ctx1 = TraceContext.create({
        traceId: validTraceId,
        spanId: validSpanId,
        traceFlags: '01',
        requestId: validRequestId,
        parentSpanId: '1111222233334444',
      });

      const ctx2 = TraceContext.create({
        traceId: validTraceId,
        spanId: validSpanId,
        traceFlags: '01',
        requestId: validRequestId,
        parentSpanId: '1111222233334444',
      });

      expect(ctx1.equals(ctx2)).toBe(true);
    });

    it('debe retornar false si difieren en cualquier atributo', () => {
      const ctx1 = TraceContext.create({
        traceId: validTraceId,
        spanId: validSpanId,
        traceFlags: '01',
        requestId: validRequestId,
      });

      const ctx2 = TraceContext.create({
        traceId: validTraceId,
        spanId: '9999888877776666',
        traceFlags: '01',
        requestId: validRequestId,
      });

      expect(ctx1.equals(ctx2)).toBe(false);
    });
  });
});
