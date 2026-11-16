import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { TraceContext } from '../../../src/contexts/shared/domain/tracing/trace_context';
import { CorrelationContextStorage } from '../../../src/contexts/shared/infrastructure/tracing/correlation_context_storage';

declare global {
  namespace Express {
    interface Request {
      traceContext?: TraceContext;
    }
  }
}

/**
 * Distributed Tracing & Correlation Middleware (US-20).
 * Implements W3C Trace Context (Recommendation 2021) and RFC 7230/7231 (X-Request-ID).
 * Injects TraceContext into the request, decorates response headers, and executes downstream handlers
 * inside the asynchronous isolation scope of CorrelationContextStorage.
 */
export function traceContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingTraceparent =
    (req.headers['traceparent'] as string) ||
    (req.headers['x-traceparent'] as string) ||
    undefined;

  const incomingRequestId =
    (req.headers['x-request-id'] as string) ||
    (req.headers['x-correlation-id'] as string) ||
    undefined;

  const requestId =
    typeof incomingRequestId === 'string' && incomingRequestId.trim().length > 0
      ? incomingRequestId.trim()
      : randomUUID();

  let traceContext: TraceContext;

  if (incomingTraceparent && TraceContext.isValidW3C(incomingTraceparent)) {
    try {
      traceContext = TraceContext.fromW3C(incomingTraceparent, requestId);
    } catch {
      // Defensive fallback if parsing fails unexpectedly
      traceContext = TraceContext.createNew(requestId);
    }
  } else {
    // Generate fresh root trace context
    traceContext = TraceContext.createNew(requestId);
  }

  // Decorate Request
  req.traceContext = traceContext;
  req.headers['x-request-id'] = traceContext.requestId;
  req.headers['x-correlation-id'] = traceContext.requestId;

  // Decorate Response Headers
  res.setHeader('X-Request-ID', traceContext.requestId);
  res.setHeader('X-Correlation-ID', traceContext.requestId);
  res.setHeader('traceparent', traceContext.toTraceparent());

  // Execute downstream inside AsyncLocalStorage
  CorrelationContextStorage.run(traceContext, () => {
    next();
  });
}
