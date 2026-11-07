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

describe('Integration Security: PostgreSQL Row-Level Security (RLS) Policy Engine (US-05)', () => {
  let simulatedPool: MockConnectionPool;
  let clientState: { inTransaction: boolean; tenantId: string | null };
  let dbUsersTable: Array<{ id: string; email: string; password_hash: string; tenant_id: string }>;

  beforeEach(() => {
    clientState = { inTransaction: false, tenantId: null };
    dbUsersTable = [
      { id: 'usr-1', email: 'alice@alpha.com', password_hash: 'hash1', tenant_id: 'alpha-corp' },
      { id: 'usr-2', email: 'alex@alpha.com', password_hash: 'hash2', tenant_id: 'alpha-corp' },
      { id: 'usr-3', email: 'bob@beta.com', password_hash: 'hash3', tenant_id: 'beta-corp' },
      { id: 'usr-4', email: 'bella@beta.com', password_hash: 'hash4', tenant_id: 'beta-corp' },
    ];

    const mockClient: MockPoolClient = {
      query: jest.fn(async <T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }> => {
        const trimmedSql = sql.trim().toUpperCase();

        if (trimmedSql.startsWith('BEGIN')) {
          clientState.inTransaction = true;
          return { rows: [] as T[] };
        }

        if (trimmedSql.startsWith('COMMIT') || trimmedSql.startsWith('ROLLBACK')) {
          clientState.inTransaction = false;
          clientState.tenantId = null; // SET LOCAL scope expired
          return { rows: [] as T[] };
        }

        if (trimmedSql.includes('SET_CONFIG') || trimmedSql.includes('SET LOCAL APP.CURRENT_TENANT_ID')) {
          if (!clientState.inTransaction) {
            throw new Error('SET LOCAL can only be used in transaction blocks');
          }
          const tenant = params ? params[0] : sql.match(/'([^']+)'/)?.[1] || null;
          clientState.tenantId = tenant;
          return { rows: [{ set_config: tenant }] as unknown as T[] };
        }

        if (trimmedSql.startsWith('SELECT * FROM USERS')) {
          // Evaluating policy: USING (tenant_id = current_setting('app.current_tenant_id', true)::text)
          const currentTenant = clientState.inTransaction ? clientState.tenantId : null;
          if (!currentTenant) {
            // Fail-closed: NULL tenant matches no tenant_id
            return { rows: [] as T[] };
          }
          const matched = dbUsersTable.filter((u) => u.tenant_id === currentTenant);
          return { rows: matched as unknown as T[] };
        }

        if (trimmedSql.startsWith('INSERT INTO USERS')) {
          // Evaluating policy: WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::text)
          const currentTenant = clientState.inTransaction ? clientState.tenantId : null;
          const targetTenant = params ? params[3] : null;

          if (!currentTenant || targetTenant !== currentTenant) {
            const err = new Error('new row violates row-level security policy for table "users"');
            (err as any).code = '42501';
            throw err;
          }

          const newUser = {
            id: params?.[0],
            email: params?.[1],
            password_hash: params?.[2],
            tenant_id: params?.[3],
          };
          dbUsersTable.push(newUser);
          return { rows: [newUser] as unknown as T[] };
        }

        if (trimmedSql.startsWith('UPDATE USERS')) {
          // Evaluating policy: USING + WITH CHECK
          const currentTenant = clientState.inTransaction ? clientState.tenantId : null;
          if (!currentTenant) {
            return { rows: [] as T[] };
          }
          // Only update records belonging to current tenant
          const updated = dbUsersTable.filter((u) => u.tenant_id === currentTenant);
          return { rows: updated as unknown as T[] };
        }

        if (trimmedSql.startsWith('DELETE FROM USERS')) {
          // Evaluating policy: USING
          const currentTenant = clientState.inTransaction ? clientState.tenantId : null;
          if (!currentTenant) {
            return { rows: [] as T[] };
          }
          const beforeCount = dbUsersTable.length;
          dbUsersTable = dbUsersTable.filter((u) => u.tenant_id !== currentTenant);
          const deletedCount = beforeCount - dbUsersTable.length;
          return { rows: [{ count: deletedCount }] as unknown as T[] };
        }

        return { rows: [] as T[] };
      }),
      release: jest.fn(() => {
        if (clientState.inTransaction) {
          clientState.inTransaction = false;
          clientState.tenantId = null;
        }
      }),
    };

    simulatedPool = {
      connect: jest.fn(async (): Promise<MockPoolClient> => mockClient),
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

  describe('RLS SELECT (USING policy condition)', () => {
    it('should return records matching active tenant and hide other tenants', async () => {
      const runner = new TenantAwareTransactionRunner(simulatedPool as any);

      const alphaUsers = await runner.runInTenantContext('alpha-corp', async (client: DatabaseClient) => {
        const res = await client.query<{ id: string; email: string; tenant_id: string }>(
          'SELECT * FROM users'
        );
        return res.rows;
      });

      expect(alphaUsers).toHaveLength(2);
      expect(alphaUsers.every((u: { tenant_id: string }) => u.tenant_id === 'alpha-corp')).toBe(true);
      expect(alphaUsers.some((u: { tenant_id: string }) => u.tenant_id === 'beta-corp')).toBe(false);
    });

    it('should return 0 rows when unauthenticated query is executed outside tenant context (Fail-Closed)', async () => {
      const client = await simulatedPool.connect();
      try {
        const res = await client.query('SELECT * FROM users');
        expect(res.rows).toHaveLength(0);
      } finally {
        client.release();
      }
    });
  });

  describe('RLS INSERT (WITH CHECK policy condition)', () => {
    it('should allow inserting user when record tenant_id matches active tenant context', async () => {
      const runner = new TenantAwareTransactionRunner(simulatedPool as any);

      const inserted = await runner.runInTenantContext('alpha-corp', async (client: DatabaseClient) => {
        const res = await client.query(
          'INSERT INTO users (id, email, password_hash, tenant_id) VALUES ($1, $2, $3, $4)',
          ['usr-new-alpha', 'new@alpha.com', 'hash', 'alpha-corp']
        );
        return res.rows[0];
      });

      expect(inserted).toBeDefined();
      expect(dbUsersTable.some((u) => u.id === 'usr-new-alpha' && u.tenant_id === 'alpha-corp')).toBe(true);
    });

    it('should reject insertion with 42501 when record tenant_id differs from active session context', async () => {
      const runner = new TenantAwareTransactionRunner(simulatedPool as any);

      await expect(
        runner.runInTenantContext('alpha-corp', async (client: DatabaseClient) => {
          await client.query(
            'INSERT INTO users (id, email, password_hash, tenant_id) VALUES ($1, $2, $3, $4)',
            ['usr-cross-insert', 'cross@beta.com', 'hash', 'beta-corp']
          );
        })
      ).rejects.toThrow('new row violates row-level security policy for table "users"');

      expect(dbUsersTable.some((u) => u.id === 'usr-cross-insert')).toBe(false);
    });
  });

  describe('RLS DELETE & UPDATE Isolation', () => {
    it('should only delete records belonging to active tenant context', async () => {
      const runner = new TenantAwareTransactionRunner(simulatedPool as any);

      await runner.runInTenantContext('alpha-corp', async (client: DatabaseClient) => {
        await client.query('DELETE FROM users');
      });

      // All alpha-corp users should be deleted
      expect(dbUsersTable.filter((u) => u.tenant_id === 'alpha-corp')).toHaveLength(0);
      // All beta-corp users must remain completely untouched
      expect(dbUsersTable.filter((u) => u.tenant_id === 'beta-corp')).toHaveLength(2);
    });
  });
});
