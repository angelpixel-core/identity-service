import {
  HttpRequestMetricLabels,
  HttpErrorMetricLabels,
  AuthMetricLabels,
  TokenMetricLabels,
  DatabaseMetricLabels,
} from './metric_types';

/**
 * Primary domain/application port for telemetry and metrics collection (US-21).
 * Completely agnostic to underlying APM SDKs (OpenTelemetry, Prometheus, Datadog).
 */
export interface MetricsPort {
  /**
   * Records an inbound HTTP request duration and count (Latency & Traffic).
   */
  recordHttpRequest(durationSeconds: number, labels: HttpRequestMetricLabels): void;

  /**
   * Records an HTTP error occurrence (Errors Golden Signal).
   */
  recordHttpError(labels: HttpErrorMetricLabels): void;

  /**
   * Records a user or M2M authentication attempt.
   */
  recordAuthAttempt(labels: AuthMetricLabels): void;

  /**
   * Records issuance or renewal of tokens (access, refresh, ID).
   */
  recordTokensIssued(labels: TokenMetricLabels): void;

  /**
   * Records a database query or transaction latency.
   */
  recordDatabaseQuery(durationSeconds: number, labels: DatabaseMetricLabels): void;

  /**
   * Serializes collected metrics in standard exposition format (e.g., OpenMetrics / Prometheus).
   */
  getMetrics(): Promise<string>;

  /**
   * Returns the HTTP Content-Type header corresponding to the serialized metrics format.
   */
  getMetricsContentType(): string;

  /**
   * Gracefully flushes and closes active telemetry collectors.
   */
  shutdown(): Promise<void>;
}
