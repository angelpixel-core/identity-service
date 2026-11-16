import { Request, Response, NextFunction, RequestHandler } from 'express';
import { MetricsPort } from '../../domain/telemetry/metrics_port';
import { RouteNormalizer } from '../../domain/telemetry/metric_types';

/**
 * Maps standard HTTP error status codes to canonical error type identifiers.
 */
function inferErrorType(statusCode: number, customErrorType?: unknown): string {
  if (typeof customErrorType === 'string' && customErrorType.trim().length > 0) {
    return customErrorType.trim();
  }
  switch (statusCode) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'UNPROCESSABLE_ENTITY';
    case 429:
      return 'TOO_MANY_REQUESTS';
    default:
      if (statusCode >= 500) {
        return 'INTERNAL_SERVER_ERROR';
      }
      return 'CLIENT_ERROR';
  }
}

/**
 * Creates an Express HTTP middleware that records Google SRE Golden Signals
 * (Traffic, Latency, Errors) via the hexagonal MetricsPort (US-21).
 *
 * Implements anti-cardinality protection using RouteNormalizer and measures
 * sub-millisecond execution duration using process.hrtime.bigint().
 */
export function createMetricsMiddleware(metricsPort: MetricsPort): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startTime = process.hrtime.bigint();
    let recorded = false;

    const recordMetrics = (): void => {
      if (recorded) {
        return;
      }
      recorded = true;

      const diffNs = process.hrtime.bigint() - startTime;
      const durationSeconds = Number(diffNs) / 1_000_000_000;

      const rawRoute = req.baseUrl
        ? `${req.baseUrl}${req.route?.path || req.path || ''}`
        : req.route?.path || req.path || '/';
      const normalizedRoute = RouteNormalizer.normalize(rawRoute);

      const rawTenantId =
        (req as unknown as { tenantId?: unknown }).tenantId ||
        req.headers['x-tenant-id'];
      const tenantId =
        typeof rawTenantId === 'string' && rawTenantId.trim().length > 0
          ? rawTenantId.trim()
          : undefined;

      const statusCode = res.statusCode || 200;
      const method = req.method ? req.method.toUpperCase() : 'UNKNOWN';

      metricsPort.recordHttpRequest(durationSeconds, {
        method,
        route: normalizedRoute,
        statusCode,
        ...(tenantId ? { tenantId } : {}),
      });

      if (statusCode >= 400) {
        const errorType = inferErrorType(
          statusCode,
          res.locals?.errorType || res.locals?.errorCode
        );

        metricsPort.recordHttpError({
          method,
          route: normalizedRoute,
          statusCode,
          errorType,
          ...(tenantId ? { tenantId } : {}),
        });
      }
    };

    res.once('finish', recordMetrics);
    res.once('close', recordMetrics);

    next();
  };
}
