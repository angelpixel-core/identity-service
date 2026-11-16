import { InMemoryMetricsAdapter } from '../../../../../src/contexts/shared/domain/telemetry/in_memory_metrics_adapter';

describe('Telemetry Domain: InMemoryMetricsAdapter (US-21)', () => {
  let adapter: InMemoryMetricsAdapter;

  beforeEach(() => {
    adapter = new InMemoryMetricsAdapter();
  });

  afterEach(async () => {
    await adapter.shutdown();
  });

  it('should return OpenMetrics compliant content-type', () => {
    expect(adapter.getMetricsContentType()).toContain('text/plain');
  });

  it('should record HTTP requests and calculate total count and duration sum', async () => {
    adapter.recordHttpRequest(0.045, {
      method: 'GET',
      route: '/api/v1/auth/me',
      statusCode: 200,
      tenantId: 'tenant-alpha',
    });

    adapter.recordHttpRequest(0.055, {
      method: 'GET',
      route: '/api/v1/auth/me',
      statusCode: 200,
      tenantId: 'tenant-alpha',
    });

    const metrics = await adapter.getMetrics();
    expect(metrics).toContain('http_requests_total{method="GET",route="/api/v1/auth/me",status_code="200",tenant_id="tenant-alpha"} 2');
    expect(metrics).toContain('http_request_duration_seconds_sum{method="GET",route="/api/v1/auth/me",status_code="200",tenant_id="tenant-alpha"} 0.1');
    expect(metrics).toContain('http_request_duration_seconds_count{method="GET",route="/api/v1/auth/me",status_code="200",tenant_id="tenant-alpha"} 2');
  });

  it('should record HTTP errors when status is 4xx or 5xx', async () => {
    adapter.recordHttpError({
      method: 'POST',
      route: '/api/v1/auth/register',
      statusCode: 400,
      errorType: 'VALIDATION_ERROR',
      tenantId: 'tenant-beta',
    });

    const metrics = await adapter.getMetrics();
    expect(metrics).toContain('http_errors_total{method="POST",route="/api/v1/auth/register",status_code="400",error_type="VALIDATION_ERROR",tenant_id="tenant-beta"} 1');
  });

  it('should record auth attempts and token issuance', async () => {
    adapter.recordAuthAttempt({
      method: 'password',
      result: 'success',
      tenantId: 'tenant-gamma',
    });

    adapter.recordTokensIssued({
      grantType: 'authorization_code',
      tokenType: 'access_token',
      tenantId: 'tenant-gamma',
    });

    const metrics = await adapter.getMetrics();
    expect(metrics).toContain('auth_attempts_total{method="password",result="success",tenant_id="tenant-gamma"} 1');
    expect(metrics).toContain('auth_tokens_issued_total{grant_type="authorization_code",token_type="access_token",tenant_id="tenant-gamma"} 1');
  });

  it('should record database queries and measure transaction durations', async () => {
    adapter.recordDatabaseQuery(0.012, {
      operation: 'transaction',
      table: 'users',
      tenantId: 'tenant-delta',
    });

    const metrics = await adapter.getMetrics();
    expect(metrics).toContain('db_query_duration_seconds_count{operation="transaction",table="users",tenant_id="tenant-delta"} 1');
    expect(metrics).toContain('db_query_duration_seconds_sum{operation="transaction",table="users",tenant_id="tenant-delta"} 0.012');
  });

  it('should clear internal state on reset', async () => {
    adapter.recordHttpRequest(0.01, {
      method: 'GET',
      route: '/health/live',
      statusCode: 200,
    });

    adapter.reset();
    const metrics = await adapter.getMetrics();
    expect(metrics).not.toContain('http_requests_total');
  });
});
