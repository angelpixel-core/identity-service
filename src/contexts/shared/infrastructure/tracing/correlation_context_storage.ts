import { AsyncLocalStorage } from 'async_hooks';
import { TraceContext } from '../../domain/tracing/trace_context';

/**
 * Infrastructure adapter encapsulating Node.js AsyncLocalStorage for distributed tracing.
 * Provides zero-coupling access to the active TraceContext across asynchronous execution chains
 * (controllers, use cases, domain services, audit loggers, and database transaction runners).
 */
export class CorrelationContextStorage {
  private static readonly storage = new AsyncLocalStorage<TraceContext>();

  /**
   * Executes synchronous or asynchronous logic within the scope of a given TraceContext.
   */
  public static run<T>(context: TraceContext, fn: () => T): T {
    return this.storage.run(context, fn);
  }

  /**
   * Retrieves the active TraceContext, or undefined if called outside an active request cycle.
   */
  public static current(): TraceContext | undefined {
    return this.storage.getStore();
  }

  /**
   * Returns the canonical W3C traceparent header string for the active context,
   * or safely generates a new valid fallback traceparent if outside context.
   */
  public static getTraceparent(): string {
    const currentContext = this.current();
    if (currentContext) {
      return currentContext.toTraceparent();
    }
    return TraceContext.createNew().toTraceparent();
  }

  /**
   * Retrieves the active request ID, or undefined if outside context.
   */
  public static getRequestId(): string | undefined {
    return this.current()?.requestId;
  }

  /**
   * Retrieves the active correlation ID, or undefined if outside context.
   */
  public static getCorrelationId(): string | undefined {
    return this.current()?.correlationId ?? this.current()?.requestId;
  }

  /**
   * Retrieves the active trace ID, or undefined if outside context.
   */
  public static getTraceId(): string | undefined {
    return this.current()?.traceId;
  }

  /**
   * Retrieves the active span ID, or undefined if outside context.
   */
  public static getSpanId(): string | undefined {
    return this.current()?.spanId;
  }
}
