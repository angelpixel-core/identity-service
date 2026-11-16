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
    typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id'].trim().length > 0
      ? req.headers['x-request-id'].trim()
      : undefined;

  const incomingCorrelationId =
    typeof req.headers['x-correlation-id'] === 'string' && req.headers['x-correlation-id'].trim().length > 0
      ? req.headers['x-correlation-id'].trim()
      : undefined;

  const requestId = incomingRequestId || randomUUID();
  const correlationId = incomingCorrelationId || requestId;

  let traceContext: TraceContext;

  if (incomingTraceparent && TraceContext.isValidW3C(incomingTraceparent)) {
    try {
      traceContext = TraceContext.fromW3C(incomingTraceparent, requestId, correlationId);
    } catch {
      // Defensive fallback if parsing fails unexpectedly
      traceContext = TraceContext.createNew(requestId, correlationId);
    }
  } else {
    // Generate fresh root trace context
    traceContext = TraceContext.createNew(requestId, correlationId);
  }

  // Decorate Request
  req.traceContext = traceContext;
  req.headers['x-request-id'] = requestId;
  req.headers['x-correlation-id'] = correlationId;

  // Decorate Response Headers
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('X-Correlation-ID', correlationId);
  res.setHeader('traceparent', traceContext.toTraceparent());

  // Execute downstream inside AsyncLocalStorage
  CorrelationContextStorage.run(traceContext, () => {
    next();
  });
}
