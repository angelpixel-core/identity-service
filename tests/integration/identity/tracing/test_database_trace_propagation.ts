import { TenantAwareTransactionRunner } from '../../../../src/contexts/identity/infrastructure/persistence/database/tenant_aware_transaction_runner';
import { DatabaseClient } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/user/repository';
import { TraceContext } from '../../../../src/contexts/shared/domain/tracing/trace_context';
import { CorrelationContextStorage } from '../../../../src/contexts/shared/infrastructure/tracing/correlation_context_storage';

interface MockPoolClient extends DatabaseClient {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
  release: jest.Mock;
}

interface MockConnectionPool {
  connect: jest.Mock<Promise<MockPoolClient>, []>;
  query?: jest.Mock;
}

describe('Integration: Database Trace Context Propagation (US-20)', () => {
  let mockClient: MockPoolClient;
  let mockPool: MockConnectionPool;
  let sessionSettings: Record<string, string>;

  beforeEach(() => {
    sessionSettings = {};

    mockClient = {
      query: jest.fn().mockImplementation(async (sql: string, params?: any[]) => {
        const trimmed = sql.trim().toUpperCase();

        if (trimmed.startsWith('BEGIN')) {
          return { rows: [] };
        }

        if (trimmed.includes('SET_CONFIG')) {
          // Extraer variable: app.current_tenant_id, app.traceparent, app.request_id
          if (sql.includes("'app.current_tenant_id'")) {
            sessionSettings['app.current_tenant_id'] = params?.[0];
          } else if (sql.includes("'app.traceparent'")) {
            sessionSettings['app.traceparent'] = params?.[0];
          } else if (sql.includes("'app.request_id'")) {
            sessionSettings['app.request_id'] = params?.[0];
          }
          return { rows: [{ set_config: params?.[0] }] };
        }

        if (trimmed.includes('CURRENT_SETTING')) {
          if (sql.includes("'app.traceparent'")) {
            return { rows: [{ setting: sessionSettings['app.traceparent'] }] };
          }
          if (sql.includes("'app.request_id'")) {
            return { rows: [{ setting: sessionSettings['app.request_id'] }] };
          }
          if (sql.includes("'app.current_tenant_id'")) {
            return { rows: [{ setting: sessionSettings['app.current_tenant_id'] }] };
          }
        }

        if (trimmed.startsWith('COMMIT') || trimmed.startsWith('ROLLBACK')) {
          return { rows: [] };
        }

        return { rows: [] };
      }),
      release: jest.fn(),
    };

    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
    };
  });

  afterEach(() => {
    expect(CorrelationContextStorage.current()).toBeUndefined();
  });

  describe('Propagación Completa bajo CorrelationContextStorage', () => {
    it('debe registrar secuencialmente las variables locales de sesión en PostgreSQL', async () => {
      const runner = new TenantAwareTransactionRunner(mockPool as any);
      const executionLog: string[] = [];

      (mockClient.query as jest.Mock).mockImplementation(async (sql: string, params?: any[]) => {
        const trimmed = sql.trim().toUpperCase();
        if (trimmed.startsWith('BEGIN')) {
          executionLog.push('BEGIN');
          return { rows: [] };
        }
        if (sql.includes('set_config') && sql.includes("'app.current_tenant_id'")) {
          executionLog.push(`SET:tenant_id:${params?.[0]}`);
          sessionSettings['app.current_tenant_id'] = params?.[0];
          return { rows: [{ set_config: params?.[0] }] };
        }
        if (sql.includes('set_config') && sql.includes("'app.traceparent'")) {
          executionLog.push(`SET:traceparent:${params?.[0]}`);
          sessionSettings['app.traceparent'] = params?.[0];
          return { rows: [{ set_config: params?.[0] }] };
        }
        if (sql.includes('set_config') && sql.includes("'app.request_id'")) {
          executionLog.push(`SET:request_id:${params?.[0]}`);
          sessionSettings['app.request_id'] = params?.[0];
          return { rows: [{ set_config: params?.[0] }] };
        }
        if (trimmed.startsWith('COMMIT')) {
          executionLog.push('COMMIT');
          return { rows: [] };
        }
        return { rows: [] };
      });

      const sampleTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
      const sampleSpanId = '00f067aa0ba902b7';
      const sampleRequestId = 'req-tx-integ-123';

      const traceContext = TraceContext.create({
        traceId: sampleTraceId,
        spanId: sampleSpanId,
        traceFlags: '01',
        requestId: sampleRequestId,
      });

      const result = await CorrelationContextStorage.run(traceContext, async () => {
        return runner.runInTenantContext('tenant-finance', async (client) => {
          executionLog.push('IN_TRANSACTION');
          await client.query("SELECT current_setting('app.traceparent')");
          return 'tx-success-data';
        });
      });

      expect(result).toBe('tx-success-data');

      // Verificar orden estricto de invocación en la conexión relacional
      expect(executionLog).toEqual([
        'BEGIN',
        'SET:tenant_id:tenant-finance',
        `SET:traceparent:${traceContext.toTraceparent()}`,
        `SET:request_id:${sampleRequestId}`,
        'IN_TRANSACTION',
        'COMMIT',
      ]);

      // Verificar que la conexión física fue devuelta limpiamente al pool
      expect(mockPool.connect).toHaveBeenCalledTimes(1);
      expect(mockClient.release).toHaveBeenCalledWith(false);
    });
  });

  describe('Aislamiento Defensivo fuera de CorrelationContextStorage', () => {
    it('debe ejecutar la transacción solo con app.current_tenant_id cuando no hay traza activa', async () => {
      const runner = new TenantAwareTransactionRunner(mockPool as any);
      const executionLog: string[] = [];

      (mockClient.query as jest.Mock).mockImplementation(async (sql: string, params?: any[]) => {
        const trimmed = sql.trim().toUpperCase();
        if (trimmed.startsWith('BEGIN')) {
          executionLog.push('BEGIN');
          return { rows: [] };
        }
        if (sql.includes("'app.current_tenant_id'")) {
          executionLog.push(`SET:tenant_id:${params?.[0]}`);
          return { rows: [{ set_config: params?.[0] }] };
        }
        if (sql.includes('app.traceparent') || sql.includes('app.request_id')) {
          executionLog.push('UNEXPECTED_TRACE_SET');
          return { rows: [] };
        }
        if (trimmed.startsWith('COMMIT')) {
          executionLog.push('COMMIT');
          return { rows: [] };
        }
        return { rows: [] };
      });

      const result = await runner.runInTenantContext('tenant-no-trace', async () => {
        executionLog.push('IN_TRANSACTION');
        return 'untraced-payload';
      });

      expect(result).toBe('untraced-payload');
      expect(executionLog).toEqual([
        'BEGIN',
        'SET:tenant_id:tenant-no-trace',
        'IN_TRANSACTION',
        'COMMIT',
      ]);
      expect(mockClient.release).toHaveBeenCalledWith(false);
    });
  });

  describe('Manejo de Errores y Rollback', () => {
    it('debe ejecutar ROLLBACK y liberar la conexión con flag de error ante excepciones en la transacción', async () => {
      const runner = new TenantAwareTransactionRunner(mockPool as any);
      const traceContext = TraceContext.createNew('req-rollback-test');

      (mockClient.query as jest.Mock).mockImplementation(async (sql: string) => {
        const trimmed = sql.trim().toUpperCase();
        if (trimmed.startsWith('ROLLBACK')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      await expect(
        CorrelationContextStorage.run(traceContext, async () => {
          return runner.runInTenantContext('tenant-error', async () => {
            throw new Error('Database query constraint violation');
          });
        })
      ).rejects.toThrow('Database query constraint violation');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalledWith(true);
    });
  });
});
