import { TraceContext } from '../../../../../src/contexts/shared/domain/tracing/trace_context';
import { CorrelationContextStorage } from '../../../../../src/contexts/shared/infrastructure/tracing/correlation_context_storage';

describe('Infrastructure: CorrelationContextStorage (AsyncLocalStorage)', () => {
  const sampleTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
  const sampleSpanId = '00f067aa0ba902b7';

  describe('Comportamiento Fuera de Contexto (Defensive Fallbacks)', () => {
    it('debe retornar undefined cuando current() es invocado fuera de un contexto activo', () => {
      expect(CorrelationContextStorage.current()).toBeUndefined();
      expect(CorrelationContextStorage.getRequestId()).toBeUndefined();
      expect(CorrelationContextStorage.getTraceId()).toBeUndefined();
      expect(CorrelationContextStorage.getSpanId()).toBeUndefined();
    });

    it('debe generar un traceparent W3C válido de respaldo si getTraceparent() es llamado fuera de contexto', () => {
      const traceparent = CorrelationContextStorage.getTraceparent();
      expect(traceparent).toBeDefined();
      expect(TraceContext.isValidW3C(traceparent)).toBe(true);
      expect(traceparent.startsWith('00-')).toBe(true);
    });
  });

  describe('Ejecución Síncrona y Asíncrona dentro de Contexto', () => {
    it('debe acceder al contexto de traza activo durante una llamada síncrona', () => {
      const context = TraceContext.create({
        traceId: sampleTraceId,
        spanId: sampleSpanId,
        requestId: 'req-sync-1',
      });

      CorrelationContextStorage.run(context, () => {
        expect(CorrelationContextStorage.current()).toBe(context);
        expect(CorrelationContextStorage.getRequestId()).toBe('req-sync-1');
        expect(CorrelationContextStorage.getTraceId()).toBe(sampleTraceId);
        expect(CorrelationContextStorage.getSpanId()).toBe(sampleSpanId);
        expect(CorrelationContextStorage.getTraceparent()).toBe(context.toTraceparent());
      });

      // Fuera del bloque run, vuelve a ser undefined
      expect(CorrelationContextStorage.current()).toBeUndefined();
    });

    it('debe propagar el contexto a través de promesas y llamadas async/await anidadas', async () => {
      const context = TraceContext.create({
        traceId: sampleTraceId,
        spanId: sampleSpanId,
        requestId: 'req-async-nested',
      });

      await CorrelationContextStorage.run(context, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));

        const nestedAsyncCall = async () => {
          await Promise.resolve();
          return CorrelationContextStorage.current();
        };

        const retrievedContext = await nestedAsyncCall();
        expect(retrievedContext).toBe(context);
        expect(CorrelationContextStorage.getRequestId()).toBe('req-async-nested');
      });

      expect(CorrelationContextStorage.current()).toBeUndefined();
    });
  });

  describe('Aislamiento Concurrente Estricto (No Contaminación Cruzada)', () => {
    it('debe mantener contextos completamente aislados en ejecuciones paralelas concurrentes con Promise.all', async () => {
      const numberOfConcurrentRequests = 20;

      const tasks = Array.from({ length: numberOfConcurrentRequests }, (_, index) => {
        const requestId = `concurrent-req-${index}`;
        const context = TraceContext.createNew(requestId);

        return CorrelationContextStorage.run(context, async () => {
          // Introducir jitter aleatorio para mezclar las microtareas en el event loop
          const jitterMs = Math.floor(Math.random() * 20) + 1;
          await new Promise((resolve) => setTimeout(resolve, jitterMs));

          const currentContext = CorrelationContextStorage.current();
          expect(currentContext).toBeDefined();
          expect(currentContext?.requestId).toBe(requestId);
          expect(currentContext?.traceId).toBe(context.traceId);
          expect(CorrelationContextStorage.getRequestId()).toBe(requestId);
          expect(CorrelationContextStorage.getTraceId()).toBe(context.traceId);

          return {
            expectedRequestId: requestId,
            actualRequestId: currentContext?.requestId,
            traceId: currentContext?.traceId,
          };
        });
      });

      const results = await Promise.all(tasks);

      // Verificar que ningún resultado cruzó identificadores
      for (const result of results) {
        expect(result.actualRequestId).toBe(result.expectedRequestId);
      }
    });
  });
});
