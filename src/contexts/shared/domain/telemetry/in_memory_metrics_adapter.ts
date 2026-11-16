import { MetricsPort } from './metrics_port';
import {
  HttpRequestMetricLabels,
  HttpErrorMetricLabels,
  AuthMetricLabels,
  TokenMetricLabels,
  DatabaseMetricLabels,
  RouteNormalizer,
} from './metric_types';

/**
 * In-Memory Metrics Adapter for hermetic unit testing and decoupling (US-21).
 * Formats metrics in valid OpenMetrics / Prometheus plain text representation.
 */
export class InMemoryMetricsAdapter implements MetricsPort {
  private httpRequests = new Map<string, { count: number; sum: number }>();
  private httpErrors = new Map<string, number>();
  private authAttempts = new Map<string, number>();
  private tokensIssued = new Map<string, number>();
  private dbQueries = new Map<string, { count: number; sum: number }>();

  public recordHttpRequest(durationSeconds: number, labels: HttpRequestMetricLabels): void {
    const sanitized = RouteNormalizer.sanitizeHttpLabels(labels);
    const key = `method="${sanitized.method}",route="${sanitized.route}",status_code="${sanitized.statusCode}",tenant_id="${sanitized.tenantId}"`;

    const existing = this.httpRequests.get(key) || { count: 0, sum: 0 };
    this.httpRequests.set(key, {
      count: existing.count + 1,
      sum: Math.round((existing.sum + durationSeconds) * 1000) / 1000,
    });
  }

  public recordHttpError(labels: HttpErrorMetricLabels): void {
    const sanitized = RouteNormalizer.sanitizeErrorLabels(labels);
    const key = `method="${sanitized.method}",route="${sanitized.route}",status_code="${sanitized.statusCode}",error_type="${sanitized.errorType}",tenant_id="${sanitized.tenantId}"`;

    const existing = this.httpErrors.get(key) || 0;
    this.httpErrors.set(key, existing + 1);
  }

  public recordAuthAttempt(labels: AuthMetricLabels): void {
    const method = (labels.method || 'password').trim();
    const result = labels.result;
    const tenantId = labels.tenantId && labels.tenantId.trim().length > 0 ? labels.tenantId.trim() : 'none';
    const key = `method="${method}",result="${result}",tenant_id="${tenantId}"`;

    const existing = this.authAttempts.get(key) || 0;
    this.authAttempts.set(key, existing + 1);
  }

  public recordTokensIssued(labels: TokenMetricLabels): void {
    const grantType = (labels.grantType || 'unknown').trim();
    const tokenType = (labels.tokenType || 'access_token').trim();
    const tenantId = labels.tenantId && labels.tenantId.trim().length > 0 ? labels.tenantId.trim() : 'none';
    const key = `grant_type="${grantType}",token_type="${tokenType}",tenant_id="${tenantId}"`;

    const existing = this.tokensIssued.get(key) || 0;
    this.tokensIssued.set(key, existing + 1);
  }

  public recordDatabaseQuery(durationSeconds: number, labels: DatabaseMetricLabels): void {
    const operation = (labels.operation || 'query').trim();
    const table = labels.table && labels.table.trim().length > 0 ? labels.table.trim() : 'none';
    const tenantId = labels.tenantId && labels.tenantId.trim().length > 0 ? labels.tenantId.trim() : 'none';
    const key = `operation="${operation}",table="${table}",tenant_id="${tenantId}"`;

    const existing = this.dbQueries.get(key) || { count: 0, sum: 0 };
    this.dbQueries.set(key, {
      count: existing.count + 1,
      sum: Math.round((existing.sum + durationSeconds) * 1000) / 1000,
    });
  }

  public async getMetrics(): Promise<string> {
    const lines: string[] = [];

    // HTTP Requests
    if (this.httpRequests.size > 0) {
      lines.push('# HELP http_requests_total Total number of HTTP requests processed.');
      lines.push('# TYPE http_requests_total counter');
      for (const [labels, stats] of this.httpRequests.entries()) {
        lines.push(`http_requests_total{${labels}} ${stats.count}`);
      }

      lines.push('# HELP http_request_duration_seconds HTTP request duration in seconds.');
      lines.push('# TYPE http_request_duration_seconds histogram');
      for (const [labels, stats] of this.httpRequests.entries()) {
        lines.push(`http_request_duration_seconds_sum{${labels}} ${stats.sum}`);
        lines.push(`http_request_duration_seconds_count{${labels}} ${stats.count}`);
      }
    }

    // HTTP Errors
    if (this.httpErrors.size > 0) {
      lines.push('# HELP http_errors_total Total number of HTTP error responses.');
      lines.push('# TYPE http_errors_total counter');
      for (const [labels, count] of this.httpErrors.entries()) {
        lines.push(`http_errors_total{${labels}} ${count}`);
      }
    }

    // Auth Attempts
    if (this.authAttempts.size > 0) {
      lines.push('# HELP auth_attempts_total Total authentication attempts.');
      lines.push('# TYPE auth_attempts_total counter');
      for (const [labels, count] of this.authAttempts.entries()) {
        lines.push(`auth_attempts_total{${labels}} ${count}`);
      }
    }

    // Tokens Issued
    if (this.tokensIssued.size > 0) {
      lines.push('# HELP auth_tokens_issued_total Total tokens minted or rotated.');
      lines.push('# TYPE auth_tokens_issued_total counter');
      for (const [labels, count] of this.tokensIssued.entries()) {
        lines.push(`auth_tokens_issued_total{${labels}} ${count}`);
      }
    }

    // DB Queries
    if (this.dbQueries.size > 0) {
      lines.push('# HELP db_query_duration_seconds Database query or transaction duration.');
      lines.push('# TYPE db_query_duration_seconds histogram');
      for (const [labels, stats] of this.dbQueries.entries()) {
        lines.push(`db_query_duration_seconds_sum{${labels}} ${stats.sum}`);
        lines.push(`db_query_duration_seconds_count{${labels}} ${stats.count}`);
      }
    }

    return lines.join('\n') + (lines.length > 0 ? '\n' : '');
  }

  public getMetricsContentType(): string {
    return 'text/plain; version=0.0.4; charset=utf-8';
  }

  public reset(): void {
    this.httpRequests.clear();
    this.httpErrors.clear();
    this.authAttempts.clear();
    this.tokensIssued.clear();
    this.dbQueries.clear();
  }

  public async shutdown(): Promise<void> {
    this.reset();
  }
}
