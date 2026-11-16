import { OpenTelemetryMetricsAdapter } from '../../../../../src/contexts/shared/infrastructure/telemetry/opentelemetry_metrics_adapter';

describe('OpenTelemetryMetricsAdapter (US-21 Infrastructure)', () => {
  let adapter: OpenTelemetryMetricsAdapter;

  beforeEach(() => {
    adapter = new OpenTelemetryMetricsAdapter();
  });

  afterEach(async () => {
    await adapter.shutdown();
  });

  it('should return the standard Prometheus exposition content type', () => {
    const contentType = adapter.getMetricsContentType();
    expect(contentType).toBe('text/plain; version=0.0.4; charset=utf-8');
  });

  it('should record HTTP traffic and latency with configured explicit buckets', async () => {
    adapter.recordHttpRequest(0.045, {
      method: 'GET',
      route: '/health',
      statusCode: 200,
    });

    const metrics = await adapter.getMetrics();

    // Golden Signal: Traffic
    expect(metrics).toContain('# HELP http_requests_total Total number of inbound HTTP requests processed');
    expect(metrics).toContain('# TYPE http_requests_total counter');
    expect(metrics).toMatch(/http_requests_total\{[^}]*method="GET"[^}]*route="\/health"[^}]*status_code="200"[^}]*\}\s+1/);

    // Golden Signal: Latency
    expect(metrics).toContain('# HELP http_request_duration_seconds Duration of inbound HTTP requests in seconds');
    expect(metrics).toContain('# TYPE http_request_duration_seconds histogram');
    expect(metrics).toMatch(/http_request_duration_seconds_bucket\{[^}]*le="0\.05"[^}]*\}\s+1/);
    expect(metrics).toMatch(/http_request_duration_seconds_bucket\{[^}]*le="0\.025"[^}]*\}\s+0/);
    expect(metrics).toMatch(/http_request_duration_seconds_count\{[^}]*route="\/health"[^}]*\}\s+1/);
    expect(metrics).toMatch(/http_request_duration_seconds_sum\{[^}]*route="\/health"[^}]*\}\s+0\.045/);
  });

  it('should record HTTP errors with error_type and status_code', async () => {
    adapter.recordHttpError({
      method: 'POST',
      route: '/api/v1/auth/login',
      statusCode: 401,
      errorType: 'INVALID_CREDENTIALS',
      tenantId: 'tenant-omega',
    });

    const metrics = await adapter.getMetrics();

    // Golden Signal: Errors
    expect(metrics).toContain('# HELP http_errors_total Total number of inbound HTTP error responses');
    expect(metrics).toContain('# TYPE http_errors_total counter');
    expect(metrics).toMatch(/http_errors_total\{[^}]*method="POST"[^}]*route="\/api\/v1\/auth\/login"[^}]*status_code="401"[^}]*error_type="INVALID_CREDENTIALS"[^}]*tenant_id="tenant-omega"[^}]*\}\s+1/);
  });

  it('should record business and security metrics (auth attempts and token issuance)', async () => {
    adapter.recordAuthAttempt({
      method: 'password',
      result: 'failure',
      tenantId: 'tenant-auth',
    });

    adapter.recordTokensIssued({
      grantType: 'authorization_code',
      tokenType: 'access',
      tenantId: 'tenant-auth',
    });

    const metrics = await adapter.getMetrics();

    // Golden Signal: Auth & Tokens
    expect(metrics).toContain('# HELP auth_attempts_total Total user and M2M authentication attempts');
    expect(metrics).toContain('# TYPE auth_attempts_total counter');
    expect(metrics).toMatch(/auth_attempts_total\{[^}]*method="password"[^}]*result="failure"[^}]*tenant_id="tenant-auth"[^}]*\}\s+1/);

    expect(metrics).toContain('# HELP auth_tokens_issued_total Total authentication tokens minted or renewed');
    expect(metrics).toContain('# TYPE auth_tokens_issued_total counter');
    expect(metrics).toMatch(/auth_tokens_issued_total\{[^}]*grant_type="authorization_code"[^}]*token_type="access"[^}]*tenant_id="tenant-auth"[^}]*\}\s+1/);
  });

  it('should record database query latency in db_query_duration_seconds', async () => {
    adapter.recordDatabaseQuery(0.012, {
      operation: 'SELECT',
      table: 'users',
      tenantId: 'tenant-db',
    });

    const metrics = await adapter.getMetrics();

    expect(metrics).toContain('# HELP db_query_duration_seconds Duration of database queries and transactions in seconds');
    expect(metrics).toContain('# TYPE db_query_duration_seconds histogram');
    expect(metrics).toMatch(/db_query_duration_seconds_bucket\{[^}]*operation="SELECT"[^}]*table="users"[^}]*tenant_id="tenant-db"[^}]*le="0\.025"[^}]*\}\s+1/);
    expect(metrics).toMatch(/db_query_duration_seconds_count\{[^}]*operation="SELECT"[^}]*table="users"[^}]*tenant_id="tenant-db"[^}]*\}\s+1/);
  });

  it('should report runtime saturation gauges (heap memory and event loop lag)', async () => {
    const metrics = await adapter.getMetrics();

    // Golden Signal: Saturation
    expect(metrics).toContain('# HELP process_memory_heap_bytes Process heap memory usage in bytes');
    expect(metrics).toContain('# TYPE process_memory_heap_bytes gauge');
    expect(metrics).toMatch(/process_memory_heap_bytes\{[^}]*\}\s+[1-9]\d*/);

    expect(metrics).toContain('# HELP nodejs_eventloop_lag_seconds Node.js event loop delay in seconds');
    expect(metrics).toContain('# TYPE nodejs_eventloop_lag_seconds gauge');
    expect(metrics).toMatch(/nodejs_eventloop_lag_seconds\{[^}]*\}\s+\d+/);
  });

  it('should sanitize labels omitting undefined or null values', async () => {
    adapter.recordHttpRequest(0.002, {
      method: 'GET',
      route: '/api/v1/public/ping',
      statusCode: 200,
      tenantId: undefined,
    });

    const metrics = await adapter.getMetrics();

    expect(metrics).not.toContain('tenant_id="undefined"');
    expect(metrics).not.toContain('tenant_id=""');
    expect(metrics).toMatch(/http_requests_total\{[^}]*route="\/api\/v1\/public\/ping"[^}]*\}\s+1/);
  });

  it('should shutdown cleanly without error', async () => {
    await expect(adapter.shutdown()).resolves.toBeUndefined();
  });
});
