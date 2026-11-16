/**
 * Telemetry Domain: Metric Types, SRE Buckets, and Anti-Cardinality Route Normalizer (US-21).
 * Adheres to OpenTelemetry Semantic Conventions and OpenMetrics standards.
 */

export const DEFAULT_LATENCY_BUCKETS = Object.freeze([
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
]);

export interface HttpRequestMetricLabels {
  method: string;
  route: string;
  statusCode: number;
  tenantId?: string;
}

export interface HttpErrorMetricLabels {
  method: string;
  route: string;
  statusCode: number;
  errorType: string;
  tenantId?: string;
}

export interface AuthMetricLabels {
  method: string;
  result: 'success' | 'failure';
  tenantId?: string;
}

export interface TokenMetricLabels {
  grantType: string;
  tokenType: string;
  tenantId?: string;
}

export interface DatabaseMetricLabels {
  operation: string;
  table?: string;
  tenantId?: string;
}

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const NUMERIC_ID_REGEX = /\/\d+(\/|$)/g;
const HEX_HASH_REGEX = /\/[0-9a-f]{32,64}(\/|$)/gi;

/**
 * Utility responsible for sanitizing labels and normalizing route paths to prevent
 * cardinality explosion in Prometheus/OpenMetrics collectors.
 */
export class RouteNormalizer {
  /**
   * Normalizes an arbitrary request path, replacing dynamic path parameters
   * (UUIDs, numbers, tokens) with generic identifiers (:id, :token).
   */
  public static normalize(rawPath?: string | null): string {
    if (!rawPath || typeof rawPath !== 'string') {
      return '/';
    }

    let cleaned = rawPath.trim();
    if (cleaned.length === 0) {
      return '/';
    }

    // Strip query string and fragments
    const queryIdx = cleaned.indexOf('?');
    if (queryIdx !== -1) {
      cleaned = cleaned.substring(0, queryIdx);
    }
    const hashIdx = cleaned.indexOf('#');
    if (hashIdx !== -1) {
      cleaned = cleaned.substring(0, hashIdx);
    }

    // Ensure leading slash
    if (!cleaned.startsWith('/')) {
      cleaned = `/${cleaned}`;
    }

    // Remove trailing slash if longer than 1 character
    if (cleaned.length > 1 && cleaned.endsWith('/')) {
      cleaned = cleaned.substring(0, cleaned.length - 1);
    }

    // Replace UUIDs with :id
    cleaned = cleaned.replace(UUID_REGEX, ':id');

    // Replace hex tokens/hashes with :token
    cleaned = cleaned.replace(HEX_HASH_REGEX, (match) => {
      return match.endsWith('/') ? '/:token/' : '/:token';
    });

    // Replace numeric IDs with :id
    cleaned = cleaned.replace(NUMERIC_ID_REGEX, (match) => {
      return match.endsWith('/') ? '/:id/' : '/:id';
    });

    return cleaned;
  }

  /**
   * Sanitizes HTTP metric labels to guarantee uppercase methods and default tenant.
   */
  public static sanitizeHttpLabels(labels: HttpRequestMetricLabels): HttpRequestMetricLabels {
    return {
      method: (labels.method || 'GET').trim().toUpperCase(),
      route: RouteNormalizer.normalize(labels.route),
      statusCode: labels.statusCode,
      tenantId: labels.tenantId && labels.tenantId.trim().length > 0 ? labels.tenantId.trim() : 'none',
    };
  }

  /**
   * Sanitizes HTTP error metric labels.
   */
  public static sanitizeErrorLabels(labels: HttpErrorMetricLabels): HttpErrorMetricLabels {
    return {
      method: (labels.method || 'GET').trim().toUpperCase(),
      route: RouteNormalizer.normalize(labels.route),
      statusCode: labels.statusCode,
      errorType: (labels.errorType || 'UNKNOWN_ERROR').trim().toUpperCase(),
      tenantId: labels.tenantId && labels.tenantId.trim().length > 0 ? labels.tenantId.trim() : 'none',
    };
  }
}
