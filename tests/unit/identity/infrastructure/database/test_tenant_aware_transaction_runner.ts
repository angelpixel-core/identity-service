import { TenantAwareTransactionRunner } from '../../../../../src/contexts/identity/infrastructure/persistence/database/tenant_aware_transaction_runner';
import { TenantId } from '../../../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { TenantSessionContext } from '../../../../../src/contexts/identity/domain/value_objects/tenant_session_context/value';
import { CrossTenantContextViolationError } from '../../../../../src/contexts/identity/domain/exceptions/security/error';
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

    it('should support TenantSessionContext Value Object as tenant parameter', async () => {
      const runner = new TenantAwareTransactionRunner(mockPool as any);
      const sessionContext = TenantSessionContext.create('tenant-session-org');

      const result = await runner.runInTenantContext(sessionContext, async () => 'success-context');

      expect(result).toBe('success-context');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('set_config'),
        ['tenant-session-org', true]
      );
    });

    it('should pass active TenantSessionContext as second argument to the operation callback', async () => {
      const runner = new TenantAwareTransactionRunner(mockPool as any);
      let receivedSession: TenantSessionContext | undefined;

      await runner.runInTenantContext('tenant-callback-org', async (_client, session) => {
        receivedSession = session;
        return 'done';
      });

      expect(receivedSession).toBeInstanceOf(TenantSessionContext);
      expect(receivedSession?.getTenantIdValue()).toBe('tenant-callback-org');
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
      expect(mockClient.release).toHaveBeenCalledWith(true);
    });

    it('should log critical error and attach rollbackError when ROLLBACK fails', async () => {
      const mockLogger = {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
      };
      const runner = new TenantAwareTransactionRunner(mockPool as any, mockLogger);

      (mockClient.query as jest.Mock).mockImplementation(async (sql: string) => {
        const trimmed = sql.trim().toUpperCase();
        if (trimmed.startsWith('BEGIN') || trimmed.includes('SET_CONFIG')) {
          return { rows: [] };
        }
        if (trimmed.startsWith('ROLLBACK')) {
          throw new Error('Database connection lost during rollback');
        }
        return { rows: [] };
      });

      const rootError = new Error('Original business domain error');

      let thrownError: any;
      try {
        await runner.runInTenantContext('alpha-corp', async () => {
          throw rootError;
        });
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBe(rootError);
      expect(thrownError.rollbackError).toBeDefined();
      expect(thrownError.rollbackError.message).toBe('Database connection lost during rollback');
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Critical failure executing ROLLBACK'),
        expect.objectContaining({
          primaryError: rootError,
          rollbackError: expect.any(Error),
        })
      );
      // Connection MUST be discarded from pool with truthy error flag
      expect(mockClient.release).toHaveBeenCalledWith(true);
    });

    it('should release connection with false flag on success to allow clean recycling', async () => {
      const runner = new TenantAwareTransactionRunner(mockPool as any);

      await runner.runInTenantContext('alpha-corp', async () => 'success');

      expect(mockClient.release).toHaveBeenCalledWith(false);
    });
  });

  describe('Nested Transactions and Savepoints (ADR-0005 & US-05 Refactoring)', () => {
    it('should create SAVEPOINT and RELEASE SAVEPOINT when nesting within the same tenant context', async () => {
      const runner = new TenantAwareTransactionRunner(mockPool as any);
      const executionSteps: string[] = [];

      (mockClient.query as jest.Mock).mockImplementation(async (sql: string) => {
        const trimmed = sql.trim().toUpperCase();
        if (trimmed.startsWith('BEGIN')) {
          executionSteps.push('BEGIN');
        } else if (trimmed.includes('SET_CONFIG')) {
          executionSteps.push('SET_CONFIG');
        } else if (trimmed.startsWith('SAVEPOINT')) {
          executionSteps.push('SAVEPOINT');
        } else if (trimmed.startsWith('RELEASE SAVEPOINT')) {
          executionSteps.push('RELEASE_SAVEPOINT');
        } else if (trimmed.startsWith('COMMIT')) {
          executionSteps.push('COMMIT');
        }
        return { rows: [] };
      });

      const result = await runner.runInTenantContext('alpha-corp', async (outerClient) => {
        executionSteps.push('OUTER_START');

        // Nested call with same tenant passing the active outerClient
        const innerResult = await runner.runInTenantContext('alpha-corp', async () => {
          executionSteps.push('INNER_OPERATION');
          return 'inner-done';
        }, outerClient);

        executionSteps.push('OUTER_END');
        return innerResult;
      });

      expect(result).toBe('inner-done');
      expect(executionSteps).toEqual([
        'BEGIN',
        'SET_CONFIG',
        'OUTER_START',
        'SAVEPOINT',
        'INNER_OPERATION',
        'RELEASE_SAVEPOINT',
        'OUTER_END',
        'COMMIT',
      ]);
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('should ROLLBACK TO SAVEPOINT and rethrow when nested operation fails without aborting outer transaction', async () => {
      const runner = new TenantAwareTransactionRunner(mockPool as any);
      const executionSteps: string[] = [];

      (mockClient.query as jest.Mock).mockImplementation(async (sql: string) => {
        const trimmed = sql.trim().toUpperCase();
        if (trimmed.startsWith('BEGIN')) {
          executionSteps.push('BEGIN');
        } else if (trimmed.includes('SET_CONFIG')) {
          executionSteps.push('SET_CONFIG');
        } else if (trimmed.startsWith('SAVEPOINT')) {
          executionSteps.push('SAVEPOINT');
        } else if (trimmed.startsWith('ROLLBACK TO SAVEPOINT')) {
          executionSteps.push('ROLLBACK_TO_SAVEPOINT');
        } else if (trimmed.startsWith('COMMIT')) {
          executionSteps.push('COMMIT');
        }
        return { rows: [] };
      });

      await runner.runInTenantContext('alpha-corp', async (outerClient) => {
        try {
          await runner.runInTenantContext('alpha-corp', async () => {
            throw new Error('Nested partial failure');
          }, outerClient);
        } catch (err: any) {
          executionSteps.push(`CAUGHT:${err.message}`);
        }
        return 'recovered-outer';
      });

      expect(executionSteps).toEqual([
        'BEGIN',
        'SET_CONFIG',
        'SAVEPOINT',
        'ROLLBACK_TO_SAVEPOINT',
        'CAUGHT:Nested partial failure',
        'COMMIT',
      ]);
      expect(mockClient.release).toHaveBeenCalledWith(false);
    });

    it('should throw CrossTenantContextViolationError when attempting to nest a different tenant within an active transaction', async () => {
      const runner = new TenantAwareTransactionRunner(mockPool as any);

      await runner.runInTenantContext('alpha-corp', async (outerClient) => {
        await expect(
          runner.runInTenantContext('beta-corp', async () => {
            return 'should-not-run';
          }, outerClient)
        ).rejects.toThrow(CrossTenantContextViolationError);
      });
    });

    it('should support withClient to create a bound runner that automatically operates under Savepoints', async () => {
      const runner = new TenantAwareTransactionRunner(mockPool as any);
      const session = TenantSessionContext.create('alpha-corp');

      (mockClient.query as jest.Mock).mockImplementation(async (sql: string) => {
        const trimmed = sql.trim().toUpperCase();
        if (trimmed.startsWith('SAVEPOINT')) {
          return { rows: [] };
        }
        if (trimmed.startsWith('RELEASE SAVEPOINT')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      const boundRunner = runner.withClient(mockClient, session);

      const result = await boundRunner.runInTenantContext('alpha-corp', async () => 'bound-success');

      expect(result).toBe('bound-success');
      expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('SAVEPOINT'));
      expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('RELEASE SAVEPOINT'));
      // No pool connect or client release in bound runner
      expect(mockPool.connect).not.toHaveBeenCalled();
      expect(mockClient.release).not.toHaveBeenCalled();
    });
  });
});
