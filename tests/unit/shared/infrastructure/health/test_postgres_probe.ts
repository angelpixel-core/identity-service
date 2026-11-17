import {
  PostgresProbe,
  SqlQueryClient,
} from '../../../../../src/contexts/shared/infrastructure/health/probes/postgres_probe';

describe('Infrastructure Health Probe: PostgresProbe (US-22)', () => {
  it('should return status OK when database query succeeds', async () => {
    let executedSql = '';
    const mockClient: SqlQueryClient = {
      query: async (sql: string) => {
        executedSql = sql;
        return { rows: [{ alive: 1 }] };
      },
    };

    const probe = new PostgresProbe(mockClient, 1000);
    const result = await probe.check();

    expect(executedSql).toBe('SELECT 1 AS alive');
    expect(result.name).toBe('database');
    expect(result.status).toBe('OK');
    expect(result.isCritical).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.timestamp).toBeDefined();
    expect(result.reason).toBeUndefined();
  });

  it('should return status DOWN with error message when query fails', async () => {
    const mockClient: SqlQueryClient = {
      query: async () => {
        throw new Error('Connection terminated unexpectedly');
      },
    };

    const probe = new PostgresProbe(mockClient, 1000);
    const result = await probe.check();

    expect(result.name).toBe('database');
    expect(result.status).toBe('DOWN');
    expect(result.isCritical).toBe(true);
    expect(result.reason).toBe('Connection terminated unexpectedly');
  });

  it('should enforce timeout and return TIMEOUT when query takes too long', async () => {
    const mockClient: SqlQueryClient = {
      query: async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return { rows: [{ alive: 1 }] };
      },
    };

    const probe = new PostgresProbe(mockClient, 30);
    const result = await probe.check();

    expect(result.name).toBe('database');
    expect(result.status).toBe('TIMEOUT');
    expect(result.isCritical).toBe(true);
    expect(result.reason).toContain('PostgreSQL query timed out after 30ms');
  });
});
