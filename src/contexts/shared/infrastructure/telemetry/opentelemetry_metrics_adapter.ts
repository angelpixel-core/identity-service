import {
  Counter,
  Histogram,
  Meter,
  ObservableGauge,
  Attributes,
} from '@opentelemetry/api';
import {
  MeterProvider,
  AggregationType,
} from '@opentelemetry/sdk-metrics';
import {
  PrometheusExporter,
  PrometheusSerializer,
} from '@opentelemetry/exporter-prometheus';
import { monitorEventLoopDelay } from 'perf_hooks';
import { MetricsPort } from '../../domain/telemetry/metrics_port';
import {
  HttpRequestMetricLabels,
  HttpErrorMetricLabels,
  AuthMetricLabels,
  TokenMetricLabels,
  DatabaseMetricLabels,
  DEFAULT_LATENCY_BUCKETS,
} from '../../domain/telemetry/metric_types';

/**
 * Production-ready OpenTelemetry SDK implementation of MetricsPort (US-21).
 * Gathers Google SRE Golden Signals (Traffic, Latency, Errors, Saturation)
 * and exposes them via Prometheus / OpenMetrics exposition format.
 */
export class OpenTelemetryMetricsAdapter implements MetricsPort {
  private readonly meterProvider: MeterProvider;
  private readonly exporter: PrometheusExporter;
  private readonly serializer: PrometheusSerializer;
  private readonly meter: Meter;

  // Golden Signals - Traffic & Latency & Errors
  private readonly httpRequestsTotal: Counter;
  private readonly httpRequestDurationSeconds: Histogram;
  private readonly httpErrorsTotal: Counter;

  // Golden Signals - Business & Security (Auth & Tokens)
  private readonly authAttemptsTotal: Counter;
  private readonly authTokensIssuedTotal: Counter;

  // Golden Signals - Database Operations
  private readonly dbQueryDurationSeconds: Histogram;

  // Golden Signals - Runtime Saturation Gauges
  private readonly processMemoryHeapBytes: ObservableGauge;
  private readonly nodejsEventLoopLagSeconds: ObservableGauge;
  private readonly eventLoopHistogram: ReturnType<typeof monitorEventLoopDelay>;

  constructor() {
    this.exporter = new PrometheusExporter({
      preventServerStart: true,
    });
    this.serializer = new PrometheusSerializer();

    this.meterProvider = new MeterProvider({
      readers: [this.exporter],
      views: [
        {
          instrumentName: '*_duration_seconds',
          aggregation: {
            type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
            options: {
              boundaries: [...DEFAULT_LATENCY_BUCKETS],
            },
          },
        },
      ],
    });

    this.meter = this.meterProvider.getMeter('@angelpixel-core/identity-service');

    // 1. Traffic (Counter)
    this.httpRequestsTotal = this.meter.createCounter('http_requests_total', {
      description: 'Total number of inbound HTTP requests processed',
    });

    // 2. Latency (Histogram)
    this.httpRequestDurationSeconds = this.meter.createHistogram(
      'http_request_duration_seconds',
      {
        description: 'Duration of inbound HTTP requests in seconds',
        unit: 's',
      }
    );

    // 3. Errors (Counter)
    this.httpErrorsTotal = this.meter.createCounter('http_errors_total', {
      description: 'Total number of inbound HTTP error responses',
    });

    // 4. Auth & Security (Counters)
    this.authAttemptsTotal = this.meter.createCounter('auth_attempts_total', {
      description: 'Total user and M2M authentication attempts',
    });

    this.authTokensIssuedTotal = this.meter.createCounter('auth_tokens_issued_total', {
      description: 'Total authentication tokens minted or renewed',
    });

    // 5. Database (Histogram)
    this.dbQueryDurationSeconds = this.meter.createHistogram(
      'db_query_duration_seconds',
      {
        description: 'Duration of database queries and transactions in seconds',
        unit: 's',
      }
    );

    // 6. Runtime Saturation (Observable Gauges)
    this.processMemoryHeapBytes = this.meter.createObservableGauge(
      'process_memory_heap_bytes',
      {
        description: 'Process heap memory usage in bytes',
        unit: 'By',
      }
    );
    this.processMemoryHeapBytes.addCallback((observableResult) => {
      observableResult.observe(process.memoryUsage().heapUsed);
    });

    this.eventLoopHistogram = monitorEventLoopDelay({ resolution: 20 });
    this.eventLoopHistogram.enable();

    this.nodejsEventLoopLagSeconds = this.meter.createObservableGauge(
      'nodejs_eventloop_lag_seconds',
      {
        description: 'Node.js event loop delay in seconds',
        unit: 's',
      }
    );
    this.nodejsEventLoopLagSeconds.addCallback((observableResult) => {
      const meanSeconds = this.eventLoopHistogram.mean / 1e9;
      observableResult.observe(Number.isFinite(meanSeconds) && meanSeconds >= 0 ? meanSeconds : 0);
    });
  }

  public recordHttpRequest(durationSeconds: number, labels: HttpRequestMetricLabels): void {
    const attributes = this.sanitizeLabels(labels);
    this.httpRequestsTotal.add(1, attributes);
    this.httpRequestDurationSeconds.record(durationSeconds, attributes);
  }

  public recordHttpError(labels: HttpErrorMetricLabels): void {
    this.httpErrorsTotal.add(1, this.sanitizeLabels(labels));
  }

  public recordAuthAttempt(labels: AuthMetricLabels): void {
    this.authAttemptsTotal.add(1, this.sanitizeLabels(labels));
  }

  public recordTokensIssued(labels: TokenMetricLabels): void {
    this.authTokensIssuedTotal.add(1, this.sanitizeLabels(labels));
  }

  public recordDatabaseQuery(durationSeconds: number, labels: DatabaseMetricLabels): void {
    this.dbQueryDurationSeconds.record(durationSeconds, this.sanitizeLabels(labels));
  }

  public async getMetrics(): Promise<string> {
    const { resourceMetrics } = await this.exporter.collect();
    return this.serializer.serialize(resourceMetrics);
  }

  public getMetricsContentType(): string {
    return 'text/plain; version=0.0.4; charset=utf-8';
  }

  public async shutdown(): Promise<void> {
    this.eventLoopHistogram.disable();
    await this.meterProvider.shutdown();
  }

  private sanitizeLabels<T extends object>(labels: T): Attributes {
    const sanitized: Attributes = {};
    for (const [key, value] of Object.entries(labels as Record<string, unknown>)) {
      if (value !== undefined && value !== null && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
        const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
        sanitized[snakeKey] = value;
      }
    }
    return sanitized;
  }
}
