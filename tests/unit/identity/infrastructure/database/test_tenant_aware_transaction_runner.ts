import { TenantAwareTransactionRunner } from '../../../../../src/contexts/identity/infrastructure/persistence/database/tenant_aware_transaction_runner';
import { TenantId } from '../../../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { DatabaseClient } from '../../../../../src/contexts/identity/infrastructure/persistence/repositories/user/repository';

interface MockPoolClient extends DatabaseClient {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
  release: jest.Mock;
}

interface MockConnectionPool {
  connect: jest.Mock<Promise<MockPoolClient>, []>;
  query?: jest.Mock;
}

describe('Unit: TenantAwareTransactionRunner', () => {
  let mockClient: MockPoolClient;
  let mockPool: MockConnectionPool;

  beforeEach(() => {
    mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };

    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
    };
  });

  describe('Validation of Tenant Identifier', () => {
    it('should reject execution with error when tenantId is empty string', async () => {
      const runner = new TenantAwareTransactionRunner(mockPool as any);

      await expect(
        runner.runInTenantContext('', async () => 'test')
      ).rejects.toThrow('tenantId cannot be empty');

      expect(mockPool.connect).not.toHaveBeenCalled();
    });

    it('should reject execution with error when tenantId is only whitespace', async () => {
      const runner = new TenantAwareTransactionRunner(mockPool as any);

      await expect(
        runner.runInTenantContext('   ', async () => 'test')
      ).rejects.toThrow('tenantId cannot be empty');

      expect(mockPool.connect).not.toHaveBeenCalled();
    });

    it('should support TenantId Value Object as tenant identifier', async () => {
      const runner = new TenantAwareTransactionRunner(mockPool as any);
      const tenantVo = TenantId.create('tenant-vo-org');

      const result = await runner.runInTenantContext(tenantVo, async () => 'success-vo');

      expect(result).toBe('success-vo');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('set_config'),
        ['tenant-vo-org', true]
      );
    });

    it('should trim string tenant identifiers before setting configuration', async () => {
      const runner = new TenantAwareTransactionRunner(mockPool as any);

      await runner.runInTenantContext('  tenant-trimmed-org  ', async () => 'success');

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('set_config'),
        ['tenant-trimmed-org', true]
      );
    });
  });

  describe('Transactional Lifecycle (Happy Path)', () => {
    it('should execute BEGIN, set_config with true (local), callback, COMMIT and release client', async () => {
      const runner = new TenantAwareTransactionRunner(mockPool as any);
      const executionSteps: string[] = [];

      (mockClient.query as jest.Mock).mockImplementation(async (sql: string, params?: any[]) => {
        const trimmed = sql.trim().toUpperCase();
        if (trimmed.startsWith('BEGIN')) {
          executionSteps.push('BEGIN');
        } else if (trimmed.includes('SET_CONFIG')) {
          executionSteps.push(`SET_CONFIG(${params?.[0]}, ${params?.[1]})`);
        } else if (trimmed.startsWith('COMMIT')) {
          executionSteps.push('COMMIT');
        } else {
          executionSteps.push(`QUERY:${trimmed}`);
        }
        return { rows: [] };
      });

      const callbackResult = await runner.runInTenantContext('alpha-corp', async (client: DatabaseClient) => {
        executionSteps.push('CALLBACK_START');
        await client.query('SELECT 1');
        executionSteps.push('CALLBACK_END');
        return { message: 'registered' };
      });

      expect(callbackResult).toEqual({ message: 'registered' });
      expect(mockPool.connect).toHaveBeenCalledTimes(1);
      expect(executionSteps).toEqual([
        'BEGIN',
        'SET_CONFIG(alpha-corp, true)',
        'CALLBACK_START',
        'QUERY:SELECT 1',
        'CALLBACK_END',
        'COMMIT',
      ]);
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Handling and Rollback Guarantees', () => {
    it('should execute ROLLBACK, release client and rethrow error when callback throws an exception', async () => {
      const runner = new TenantAwareTransactionRunner(mockPool as any);
      const executionSteps: string[] = [];

      (mockClient.query as jest.Mock).mockImplementation(async (sql: string) => {
        const trimmed = sql.trim().toUpperCase();
        if (trimmed.startsWith('BEGIN')) {
          executionSteps.push('BEGIN');
        } else if (trimmed.includes('SET_CONFIG')) {
          executionSteps.push('SET_CONFIG');
        } else if (trimmed.startsWith('ROLLBACK')) {
          executionSteps.push('ROLLBACK');
        }
        return { rows: [] };
      });

      const businessError = new Error('Unique constraint violation on email');

      await expect(
        runner.runInTenantContext('alpha-corp', async () => {
          executionSteps.push('CALLBACK_EXCEPTION');
          throw businessError;
        })
      ).rejects.toThrow('Unique constraint violation on email');

      expect(executionSteps).toEqual([
        'BEGIN',
        'SET_CONFIG',
        'CALLBACK_EXCEPTION',
        'ROLLBACK',
      ]);
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('should release client and rethrow without invoking callback if BEGIN fails', async () => {
      const runner = new TenantAwareTransactionRunner(mockPool as any);
      (mockClient.query as jest.Mock).mockRejectedValueOnce(new Error('Connection terminated unexpectedly'));

      const callback = jest.fn();

      await expect(
        runner.runInTenantContext('alpha-corp', callback)
      ).rejects.toThrow('Connection terminated unexpectedly');

      expect(callback).not.toHaveBeenCalled();
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('should execute ROLLBACK and release client if set_config query fails', async () => {
      const runner = new TenantAwareTransactionRunner(mockPool as any);

      (mockClient.query as jest.Mock).mockImplementation(async (sql: string) => {
        const trimmed = sql.trim().toUpperCase();
        if (trimmed.startsWith('BEGIN')) {
          return { rows: [] };
        }
        if (trimmed.includes('SET_CONFIG')) {
          throw new Error('Permission denied to set parameter');
        }
        if (trimmed.startsWith('ROLLBACK')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      const callback = jest.fn();

      await expect(
        runner.runInTenantContext('alpha-corp', callback)
      ).rejects.toThrow('Permission denied to set parameter');

      expect(callback).not.toHaveBeenCalled();
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('should attempt ROLLBACK and release client if COMMIT query fails', async () => {
      const runner = new TenantAwareTransactionRunner(mockPool as any);

      (mockClient.query as jest.Mock).mockImplementation(async (sql: string) => {
        const trimmed = sql.trim().toUpperCase();
        if (trimmed.startsWith('BEGIN') || trimmed.includes('SET_CONFIG')) {
          return { rows: [] };
        }
        if (trimmed.startsWith('COMMIT')) {
          throw new Error('Serialization failure during commit');
        }
        if (trimmed.startsWith('ROLLBACK')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      await expect(
        runner.runInTenantContext('alpha-corp', async () => 'data')
      ).rejects.toThrow('Serialization failure during commit');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });
  });
});
