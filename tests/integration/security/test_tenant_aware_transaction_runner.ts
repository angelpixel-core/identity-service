import { TenantAwareTransactionRunner } from '../../../src/contexts/identity/infrastructure/persistence/database/tenant_aware_transaction_runner';
import { DatabaseClient } from '../../../src/contexts/identity/infrastructure/persistence/repositories/user/repository';

interface MockPoolClient extends DatabaseClient {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
  release: jest.Mock;
}

describe('Integration Security: TenantAwareTransactionRunner (US-05)', () => {
  let mockClient: MockPoolClient;
  let mockPool: {
    connect: jest.Mock;
    query: jest.Mock;
  };

  beforeEach(() => {
    mockClient = {
      query: jest.fn().mockImplementation(async (sql: string, params?: any[]) => {
        const trimmed = sql.trim().toUpperCase();
        if (trimmed.startsWith('SELECT SET_CONFIG')) {
          return { rows: [{ set_config: params?.[0] }] };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };

    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      query: jest.fn(),
    };
  });

  describe('runInTenantContext lifecycle', () => {
    it('should acquire connection, begin transaction, set local tenant parameter, execute callback, commit, and release', async () => {
      const runner = new TenantAwareTransactionRunner(mockPool as any);
      const executionLog: string[] = [];

      (mockClient.query as jest.Mock).mockImplementation(async (sql: string, params?: any[]) => {
        const trimmed = sql.trim().toUpperCase();
        if (trimmed.startsWith('BEGIN')) {
          executionLog.push('BEGIN');
          return { rows: [] };
        }
        if (trimmed.includes('SET_CONFIG')) {
          executionLog.push(`SET_CONFIG:${params?.[0]}:${params?.[1]}`);
          return { rows: [{ set_config: params?.[0] }] };
        }
        if (trimmed.startsWith('COMMIT')) {
          executionLog.push('COMMIT');
          return { rows: [] };
        }
        return { rows: [] };
      });

      const result = await runner.runInTenantContext('tenant-acme', async (client: DatabaseClient) => {
        executionLog.push('CALLBACK_START');
        await client.query('SELECT 1');
        executionLog.push('CALLBACK_END');
        return 'success-payload';
      });

      expect(result).toBe('success-payload');
      expect(mockPool.connect).toHaveBeenCalledTimes(1);

      // Verify strict sequential execution
      expect(executionLog).toEqual([
        'BEGIN',
        'SET_CONFIG:tenant-acme:true',
        'CALLBACK_START',
        'CALLBACK_END',
        'COMMIT',
      ]);

      // Verify connection release
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('should rollback transaction and release connection when callback throws error', async () => {
      const runner = new TenantAwareTransactionRunner(mockPool as any);
      const executionLog: string[] = [];

      (mockClient.query as jest.Mock).mockImplementation(async (sql: string) => {
        const trimmed = sql.trim().toUpperCase();
        if (trimmed.startsWith('BEGIN')) {
          executionLog.push('BEGIN');
          return { rows: [] };
        }
        if (trimmed.includes('SET_CONFIG')) {
          executionLog.push('SET_CONFIG');
          return { rows: [] };
        }
        if (trimmed.startsWith('ROLLBACK')) {
          executionLog.push('ROLLBACK');
          return { rows: [] };
        }
        return { rows: [] };
      });

      const customError = new Error('Database dead lock simulated');

      await expect(
        runner.runInTenantContext('tenant-fail', async () => {
          executionLog.push('CALLBACK_THROWS');
          throw customError;
        })
      ).rejects.toThrow('Database dead lock simulated');

      expect(executionLog).toEqual([
        'BEGIN',
        'SET_CONFIG',
        'CALLBACK_THROWS',
        'ROLLBACK',
      ]);

      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('should reject execution when tenantId is empty or whitespace', async () => {
      const runner = new TenantAwareTransactionRunner(mockPool as any);

      await expect(
        runner.runInTenantContext('', async () => {
          return 'should not reach';
        })
      ).rejects.toThrow();

      // No connection should be acquired for invalid tenantId
      expect(mockPool.connect).not.toHaveBeenCalled();
    });
  });
});
