import { TenantAwareTransactionRunner } from '../../../src/contexts/identity/infrastructure/persistence/database/tenant_aware_transaction_runner';
import { DatabaseClient } from '../../../src/contexts/identity/infrastructure/persistence/repositories/user/repository';

interface MockPoolClient extends DatabaseClient {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
  release(): void;
}

interface MockConnectionPool {
  connect(): Promise<MockPoolClient>;
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
}

describe('Feature: Database Tenant Session Context & RLS Policies Migration', () => {
  let simulatedPool: MockConnectionPool;
  let singlePooledConnection: MockPoolClient;
  let connectionState: { inTransaction: boolean; tenantId: string | null };

  const initialUsersTable = [
    { id: 'usr-alpha-1', email: 'admin@alpha.com', tenant_id: 'alpha-corp' },
    { id: 'usr-alpha-2', email: 'dev@alpha.com', tenant_id: 'alpha-corp' },
    { id: 'usr-beta-1', email: 'ceo@beta.com', tenant_id: 'beta-corp' },
  ];

  beforeEach(() => {
    connectionState = { inTransaction: false, tenantId: null };

    singlePooledConnection = {
      query: jest.fn(async <T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }> => {
        const trimmedSql = sql.trim().toUpperCase();

        if (trimmedSql.startsWith('BEGIN')) {
          connectionState.inTransaction = true;
          return { rows: [] as T[] };
        }

        if (trimmedSql.startsWith('COMMIT') || trimmedSql.startsWith('ROLLBACK')) {
          connectionState.inTransaction = false;
          // In PostgreSQL, SET LOCAL configuration setting clears upon transaction termination
          connectionState.tenantId = null;
          return { rows: [] as T[] };
        }

        if (trimmedSql.includes('SET_CONFIG') || trimmedSql.includes('SET LOCAL APP.CURRENT_TENANT_ID')) {
          if (!connectionState.inTransaction) {
            throw new Error('SET LOCAL can only be used in transaction blocks');
          }
          const tenantVal = params ? params[0] : sql.match(/'([^']+)'/)?.[1] || null;
          connectionState.tenantId = tenantVal;
          return { rows: [{ set_config: tenantVal }] as unknown as T[] };
        }

        if (trimmedSql.includes("CURRENT_SETTING('APP.CURRENT_TENANT_ID'")) {
          const currentTenant = connectionState.inTransaction ? connectionState.tenantId : null;
          return { rows: [{ current_tenant: currentTenant }] as unknown as T[] };
        }

        if (trimmedSql.startsWith('SELECT * FROM USERS')) {
          // RLS Policy Simulation: USING (tenant_id = current_setting('app.current_tenant_id', true)::text)
          const currentTenant = connectionState.inTransaction ? connectionState.tenantId : null;
          if (!currentTenant) {
            // Fail-closed
            return { rows: [] as T[] };
          }
          const matched = initialUsersTable.filter((u) => u.tenant_id === currentTenant);
          return { rows: matched as unknown as T[] };
        }

        return { rows: [] as T[] };
      }),
      release: jest.fn(() => {
        if (connectionState.inTransaction) {
          connectionState.inTransaction = false;
          connectionState.tenantId = null;
        }
      }),
    };

    simulatedPool = {
      connect: jest.fn(async (): Promise<MockPoolClient> => singlePooledConnection),
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

  describe('Scenario: Tenant data isolation enforced by PostgreSQL RLS', () => {
    it('should return only records belonging to alpha-corp and zero records from beta-corp', async () => {
      // Given a user belonging to tenant "alpha-corp" and another user in "beta-corp" (initialUsersTable)
      const runner = new TenantAwareTransactionRunner(simulatedPool as any);

      // When a database transaction executes with "SET LOCAL app.current_tenant_id = 'alpha-corp'"
      // And a query selects all users with "SELECT * FROM users"
      const result = await runner.runInTenantContext('alpha-corp', async (client: DatabaseClient) => {
        const queryRes = await client.query<{ id: string; email: string; tenant_id: string }>(
          'SELECT * FROM users'
        );
        return queryRes.rows;
      });

      // Then only records belonging to "alpha-corp" should be returned
      expect(result.length).toBe(2);
      expect(result.every((u: { tenant_id: string }) => u.tenant_id === 'alpha-corp')).toBe(true);

      // And zero records belonging to "beta-corp" should be exposed
      const betaRecords = result.filter((u: { tenant_id: string }) => u.tenant_id === 'beta-corp');
      expect(betaRecords).toHaveLength(0);
    });
  });

  describe('Scenario: Connection pool recycling without residual tenant state', () => {
    it('should reflect only beta-corp on subsequent pooled execution with no leakage from alpha-corp', async () => {
      const runner = new TenantAwareTransactionRunner(simulatedPool as any);

      // Given a connection used by tenant "alpha-corp" completes its transaction
      await runner.runInTenantContext('alpha-corp', async (client: DatabaseClient) => {
        const session = await client.query<{ current_tenant: string | null }>(
          "SELECT current_setting('app.current_tenant_id', true) as current_tenant"
        );
        expect(session.rows[0]?.current_tenant).toBe('alpha-corp');
      });

      // When another transaction executes on the same pooled connection for tenant "beta-corp"
      const betaResult = await runner.runInTenantContext('beta-corp', async (client: DatabaseClient) => {
        const session = await client.query<{ current_tenant: string | null }>(
          "SELECT current_setting('app.current_tenant_id', true) as current_tenant"
        );
        const users = await client.query<{ id: string; email: string; tenant_id: string }>(
          'SELECT * FROM users'
        );
        return {
          currentTenant: session.rows[0]?.current_tenant,
          rows: users.rows,
        };
      });

      // Then the session parameter should reflect only "beta-corp"
      expect(betaResult.currentTenant).toBe('beta-corp');

      // And no data from "alpha-corp" should leak into the second execution
      expect(betaResult.rows.length).toBe(1);
      expect(betaResult.rows[0]?.tenant_id).toBe('beta-corp');
      expect(betaResult.rows.some((u: { tenant_id: string }) => u.tenant_id === 'alpha-corp')).toBe(false);
    });
  });

  describe('Scenario: Fail-closed behavior when tenant context is omitted', () => {
    it('should return exactly 0 rows when an unauthenticated query executes without tenant context', async () => {
      // Given a connection where "app.current_tenant_id" was never set
      const pooledClient = await simulatedPool.connect();

      try {
        // When an unauthenticated query executes "SELECT * FROM users"
        const queryRes = await pooledClient.query('SELECT * FROM users');

        // Then the database should return exactly 0 rows
        expect(queryRes.rows).toHaveLength(0);
      } finally {
        pooledClient.release();
      }
    });
  });
});
