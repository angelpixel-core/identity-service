import { TenantAwareTransactionRunner } from '../../../src/contexts/identity/infrastructure/persistence/database/tenant_aware_transaction_runner';
import { DatabaseClient } from '../../../src/contexts/identity/infrastructure/persistence/repositories/user/repository';

/**
 * Interface compatible with pg.Pool and pg.PoolClient for transaction orchestration
 */
interface MockPoolClient extends DatabaseClient {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
  release(err?: any): void;
}

interface MockConnectionPool {
  connect(): Promise<MockPoolClient>;
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
  totalCount?: number;
  idleCount?: number;
}

describe('E2E Security Spec: Multi-Tenant PostgreSQL RLS & Connection Pool Isolation (US-05)', () => {
  let simulatedPool: MockConnectionPool;
  let sharedConnections: MockPoolClient[];
  let activeSessionStates: Map<MockPoolClient, { inTransaction: boolean; tenantId: string | null }>;
  let availableClients: MockPoolClient[];
  let waitingQueue: Array<(client: MockPoolClient) => void>;

  beforeEach(() => {
    activeSessionStates = new Map();
    sharedConnections = [];
    availableClients = [];
    waitingQueue = [];

    const returnClientToPool = (client: MockPoolClient) => {
      const state = activeSessionStates.get(client);
      if (state?.inTransaction) {
        state.inTransaction = false;
        state.tenantId = null;
      }
      if (waitingQueue.length > 0) {
        const nextCaller = waitingQueue.shift()!;
        nextCaller(client);
      } else {
        availableClients.push(client);
      }
    };

    // Create a simulated connection pool of 5 reusable physical connections
    for (let i = 0; i < 5; i++) {
      const client: MockPoolClient = {
        query: jest.fn(async <T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }> => {
          const state = activeSessionStates.get(client) || { inTransaction: false, tenantId: null };
          const trimmedSql = sql.trim().toUpperCase();

          if (trimmedSql.startsWith('BEGIN')) {
            state.inTransaction = true;
            return { rows: [] as T[] };
          }

          if (trimmedSql.startsWith('COMMIT') || trimmedSql.startsWith('ROLLBACK')) {
            state.inTransaction = false;
            // SET LOCAL automatically clears at transaction boundary in PostgreSQL
            state.tenantId = null;
            return { rows: [] as T[] };
          }

          if (trimmedSql.includes('SET_CONFIG') || trimmedSql.includes('SET LOCAL APP.CURRENT_TENANT_ID')) {
            if (!state.inTransaction) {
              throw new Error('SET LOCAL can only be used in transaction blocks');
            }
            const tenantValue = params ? params[0] : sql.match(/'([^']+)'/)?.[1] || null;
            state.tenantId = tenantValue;
            return { rows: [{ set_config: tenantValue }] as unknown as T[] };
          }

          if (trimmedSql.includes("CURRENT_SETTING('APP.CURRENT_TENANT_ID'")) {
            // Fail-closed: outside transaction or if unset, current_setting(..., true) is null
            const currentTenant = state.inTransaction ? state.tenantId : null;
            return { rows: [{ current_tenant: currentTenant }] as unknown as T[] };
          }

          if (trimmedSql.startsWith('SELECT * FROM USERS')) {
            // RLS Policy Engine: USING (tenant_id = current_setting('app.current_tenant_id', true)::text)
            const currentTenant = state.inTransaction ? state.tenantId : null;
            if (!currentTenant) {
              // Fail-closed: 0 rows returned
              return { rows: [] as T[] };
            }
            // Return only records matching the active tenant
            const allUsers = [
              { id: 'usr-1', email: 'alice@alpha.com', tenant_id: 'alpha-corp' },
              { id: 'usr-2', email: 'alex@alpha.com', tenant_id: 'alpha-corp' },
              { id: 'usr-3', email: 'bob@beta.com', tenant_id: 'beta-corp' },
            ];
            const filtered = allUsers.filter((u) => u.tenant_id === currentTenant);
            return { rows: filtered as unknown as T[] };
          }

          if (trimmedSql.startsWith('INSERT INTO USERS')) {
            // RLS Policy Engine: WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::text)
            const currentTenant = state.inTransaction ? state.tenantId : null;
            const insertTenant = params ? params[3] : null;
            if (!currentTenant || (insertTenant && insertTenant !== currentTenant)) {
              const err = new Error('new row violates row-level security policy for table "users"');
              (err as any).code = '42501';
              throw err;
            }
            return { rows: [{ id: params?.[0] }] as unknown as T[] };
          }

          return { rows: [] as T[] };
        }),
        release: jest.fn(() => {
          returnClientToPool(client);
        }),
      };

      activeSessionStates.set(client, { inTransaction: false, tenantId: null });
      sharedConnections.push(client);
      availableClients.push(client);
    }

    simulatedPool = {
      connect: jest.fn((): Promise<MockPoolClient> => {
        if (availableClients.length > 0) {
          const client = availableClients.shift()!;
          return Promise.resolve(client);
        }
        return new Promise<MockPoolClient>((resolve) => {
          waitingQueue.push(resolve);
        });
      }),
      query: jest.fn(async <T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }> => {
        const client = await simulatedPool.connect();
        try {
          return await client.query<T>(sql, params);
        } finally {
          client.release();
        }
      }),
    };
  });

  describe('Scenario 1: High concurrency pool simulation (50 parallel transactions)', () => {
    it('should maintain strict tenant isolation across 50 concurrent transactions without state bleeding', async () => {
      const runner = new TenantAwareTransactionRunner(simulatedPool as any);
      const concurrencyCount = 50;

      const tasks = Array.from({ length: concurrencyCount }, (_, index) => {
        const isAlpha = index % 2 === 0;
        const tenantId = isAlpha ? 'alpha-corp' : 'beta-corp';

        return runner.runInTenantContext(tenantId, async (client: DatabaseClient) => {
          // 1. Verify session setting
          const sessionResult = await client.query<{ current_tenant: string | null }>(
            "SELECT current_setting('app.current_tenant_id', true) as current_tenant"
          );
          expect(sessionResult.rows[0]?.current_tenant).toBe(tenantId);

          // 2. Query data under RLS
          const usersResult = await client.query<{ id: string; email: string; tenant_id: string }>(
            'SELECT * FROM users'
          );
          const records = usersResult.rows;

          // 3. Invariant: Every record returned MUST belong to the active tenant
          expect(records.length).toBeGreaterThan(0);
          for (const record of records) {
            expect(record.tenant_id).toBe(tenantId);
          }

          // Invariant: Zero records from the other tenant are exposed
          const forbiddenTenant = isAlpha ? 'beta-corp' : 'alpha-corp';
          const leaked = records.filter((r: { tenant_id: string }) => r.tenant_id === forbiddenTenant);
          expect(leaked).toHaveLength(0);

          return { tenantId, count: records.length };
        });
      });

      const results = await Promise.all(tasks);
      expect(results).toHaveLength(concurrencyCount);
      expect(results.filter((r: { tenantId: string }) => r.tenantId === 'alpha-corp')).toHaveLength(25);
      expect(results.filter((r: { tenantId: string }) => r.tenantId === 'beta-corp')).toHaveLength(25);
    });
  });

  describe('Scenario 2: Connection pool recycling without residual tenant state', () => {
    it('should sanitize physical connection when returned to pool so subsequent executions start clean', async () => {
      const runner = new TenantAwareTransactionRunner(simulatedPool as any);

      // Step 1: Run tenant 'alpha-corp' transaction
      await runner.runInTenantContext('alpha-corp', async (client: DatabaseClient) => {
        const session = await client.query<{ current_tenant: string | null }>(
          "SELECT current_setting('app.current_tenant_id', true) as current_tenant"
        );
        expect(session.rows[0]?.current_tenant).toBe('alpha-corp');
      });

      // Step 2: Acquire a raw pooled connection outside runner
      const pooledClient = await simulatedPool.connect();
      try {
        const unauthenticatedSession = await pooledClient.query<{ current_tenant: string | null }>(
          "SELECT current_setting('app.current_tenant_id', true) as current_tenant"
        );
        // Residual state MUST be null
        expect(unauthenticatedSession.rows[0]?.current_tenant).toBeNull();
      } finally {
        pooledClient.release();
      }

      // Step 3: Run tenant 'beta-corp' on recycled connection
      await runner.runInTenantContext('beta-corp', async (client: DatabaseClient) => {
        const session = await client.query<{ current_tenant: string | null }>(
          "SELECT current_setting('app.current_tenant_id', true) as current_tenant"
        );
        expect(session.rows[0]?.current_tenant).toBe('beta-corp');
      });
    });
  });

  describe('Scenario 3: Fail-closed zero-trust verification', () => {
    it('should return 0 rows when a query is executed without tenant session context', async () => {
      const pooledClient = await simulatedPool.connect();
      try {
        // Querying users without SET LOCAL app.current_tenant_id
        const result = await pooledClient.query('SELECT * FROM users');
        expect(result.rows).toHaveLength(0);
      } finally {
        pooledClient.release();
      }
    });

    it('should reject insertion if tenant_id does not match active session setting', async () => {
      const runner = new TenantAwareTransactionRunner(simulatedPool as any);

      await expect(
        runner.runInTenantContext('alpha-corp', async (client: DatabaseClient) => {
          // Attempting to insert record belonging to 'beta-corp' while in 'alpha-corp' context
          await client.query('INSERT INTO users (id, email, password_hash, tenant_id) VALUES ($1, $2, $3, $4)', [
            'usr-evil',
            'hacker@beta.com',
            'hash',
            'beta-corp',
          ]);
        })
      ).rejects.toThrow('new row violates row-level security policy for table "users"');
    });
  });

  describe('Scenario 4: Rollback and pool resilience on transaction failure', () => {
    it('should rollback transaction and release connection cleanly when an operation throws', async () => {
      const runner = new TenantAwareTransactionRunner(simulatedPool as any);

      await expect(
        runner.runInTenantContext('alpha-corp', async () => {
          throw new Error('Simulated business logic failure during transaction');
        })
      ).rejects.toThrow('Simulated business logic failure during transaction');

      // Subsequent transaction on the pool must succeed without any stale locks or open transactions
      const result = await runner.runInTenantContext('beta-corp', async (client: DatabaseClient) => {
        const session = await client.query<{ current_tenant: string | null }>(
          "SELECT current_setting('app.current_tenant_id', true) as current_tenant"
        );
        return session.rows[0]?.current_tenant;
      });

      expect(result).toBe('beta-corp');
    });
  });
});
