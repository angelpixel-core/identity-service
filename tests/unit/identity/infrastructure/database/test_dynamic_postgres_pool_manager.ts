import {
  DynamicPostgresPoolManager,
  PostgresSslOptions,
  SecurityConfigurationError,
} from '../../../../../src/contexts/identity/infrastructure/persistence/database/dynamic_postgres_pool_manager';
import { PoolClientWithRelease } from '../../../../../src/contexts/identity/infrastructure/persistence/database/tenant_aware_transaction_runner';

describe('Unit: DynamicPostgresPoolManager (US-16 Zero-Downtime Database Pool Reload)', () => {
  let mockClient: PoolClientWithRelease;
  let mockInitialPool: any;
  let mockNewPool: any;

  beforeEach(() => {
    mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: '1' }] }),
      release: jest.fn(),
    };

    mockInitialPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      query: jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('SELECT 1')) {
          return Promise.resolve({ rows: [{ health_check: 1 }] });
        }
        return Promise.resolve({ rows: [{ pool_id: 'pool-v1', value: 42 }] });
      }),
      end: jest.fn().mockResolvedValue(undefined),
      totalCount: 5,
      idleCount: 3,
      waitingCount: 0,
    };

    mockNewPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      query: jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('SELECT 1')) {
          return Promise.resolve({ rows: [{ health_check: 1 }] });
        }
        return Promise.resolve({ rows: [{ pool_id: 'pool-v2-rotated', value: 100 }] });
      }),
      end: jest.fn().mockResolvedValue(undefined),
      totalCount: 5,
      idleCount: 4,
      waitingCount: 0,
    };
  });

  it('should throw an error if instantiated without any pool configuration', () => {
    expect(() => new DynamicPostgresPoolManager({} as any)).toThrow(
      'DynamicPostgresPoolManager requires either initialPool, poolConfig or connectionString'
    );
  });

  it('should initialize with generation 1 and delegate query and connect to initialPool', async () => {
    const manager = new DynamicPostgresPoolManager({ initialPool: mockInitialPool });

    expect(manager.getGeneration()).toBe(1);
    expect(manager.getActivePool()).toBe(mockInitialPool);

    const res = await manager.query('SELECT * FROM users');
    expect(res.rows).toEqual([{ pool_id: 'pool-v1', value: 42 }]);
    expect(mockInitialPool.query).toHaveBeenCalledWith('SELECT * FROM users', undefined);

    const client = await manager.connect();
    expect(client).toBe(mockClient);
    expect(mockInitialPool.connect).toHaveBeenCalled();

    const stats = manager.getStats();
    expect(stats.generation).toBe(1);
    expect(stats.isClosed).toBe(false);
    expect(stats.activePoolTotalCount).toBe(5);
  });

  it('should successfully reload credentials, increment generation, and perform atomic swap', async () => {
    let factoryCallCount = 0;
    const poolFactory = jest.fn().mockImplementation(() => {
      factoryCallCount += 1;
      return mockNewPool;
    });

    const manager = new DynamicPostgresPoolManager({
      initialPool: mockInitialPool,
      poolFactory,
      drainGracePeriodMs: 50,
    });

    expect(manager.getGeneration()).toBe(1);

    // Trigger reload
    await manager.reloadCredentials('postgresql://new_user:new_pass@localhost:5432/id_db');

    expect(poolFactory).toHaveBeenCalledTimes(1);
    expect(mockNewPool.query).toHaveBeenCalledWith('SELECT 1 AS health_check');
    expect(manager.getGeneration()).toBe(2);
    expect(manager.getActivePool()).toBe(mockNewPool);

    // Queries now route to the new pool
    const result = await manager.query('SELECT * FROM orders');
    expect(result.rows).toEqual([{ pool_id: 'pool-v2-rotated', value: 100 }]);

    // Wait for graceful drain
    await new Promise((r) => setTimeout(r, 80));
    expect(mockInitialPool.end).toHaveBeenCalledTimes(1);

    await manager.close();
  });

  it('should fail-safe and preserve original active pool if new credentials fail health check', async () => {
    const failingPool = {
      query: jest.fn().mockRejectedValue(new Error('password authentication failed for user "new_user"')),
      end: jest.fn().mockResolvedValue(undefined),
    };

    const manager = new DynamicPostgresPoolManager({
      initialPool: mockInitialPool,
      poolFactory: () => failingPool as any,
    });

    expect(manager.getGeneration()).toBe(1);

    await expect(
      manager.reloadCredentials('postgresql://bad_user:bad_pass@localhost:5432/id_db')
    ).rejects.toThrow('password authentication failed for user "new_user"');

    // Failing pool must be cleaned up immediately
    expect(failingPool.end).toHaveBeenCalledTimes(1);

    // Active pool must remain untouched
    expect(manager.getGeneration()).toBe(1);
    expect(manager.getActivePool()).toBe(mockInitialPool);

    // Original pool continues to serve queries without disruption
    const result = await manager.query('SELECT 1');
    expect(result.rows).toEqual([{ health_check: 1 }]);
    expect(mockInitialPool.end).not.toHaveBeenCalled();

    await manager.close();
  });

  it('should allow concurrent queries in-flight on old pool to finish while swapping to new pool', async () => {
    let slowQueryCompleted = false;

    // Simulate in-flight query on old pool taking 50ms
    mockInitialPool.query.mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 50));
      slowQueryCompleted = true;
      return { rows: [{ in_flight: true }] };
    });

    const manager = new DynamicPostgresPoolManager({
      initialPool: mockInitialPool,
      poolFactory: () => mockNewPool,
      drainGracePeriodMs: 100, // Grace period exceeds in-flight query duration
    });

    // Start in-flight query without awaiting
    const inFlightPromise = manager.query('SELECT slow_function()');

    // Trigger reload concurrently
    await manager.reloadCredentials('postgresql://rotated:secret@localhost:5432/id_db');

    // New queries immediately get served by new pool
    const newQueryResult = await manager.query('SELECT fast_function()');
    expect(newQueryResult.rows).toEqual([{ pool_id: 'pool-v2-rotated', value: 100 }]);

    // In-flight query on old pool finishes cleanly
    const inFlightResult = await inFlightPromise;
    expect(slowQueryCompleted).toBe(true);
    expect(inFlightResult.rows).toEqual([{ in_flight: true }]);

    // Wait for graceful drain
    await new Promise((r) => setTimeout(r, 120));
    expect(mockInitialPool.end).toHaveBeenCalledTimes(1);

    await manager.close();
  });

  it('should close active and retiring pools gracefully on close() and reject subsequent calls', async () => {
    const manager = new DynamicPostgresPoolManager({
      initialPool: mockInitialPool,
      poolFactory: () => mockNewPool,
      drainGracePeriodMs: 500,
    });

    // Trigger reload to place initialPool in retiring set
    await manager.reloadCredentials('postgresql://user:pass@localhost:5432/id_db');

    expect(manager.getStats().retiringPoolsCount).toBe(1);

    // Call close immediately
    await manager.close();

    expect(mockNewPool.end).toHaveBeenCalled();
    expect(mockInitialPool.end).toHaveBeenCalled();
    expect(manager.getStats().isClosed).toBe(true);

    // Subsequent operations must reject
    await expect(manager.query('SELECT 1')).rejects.toThrow(
      'DynamicPostgresPoolManager is closed and cannot accept queries'
    );
    await expect(manager.connect()).rejects.toThrow(
      'DynamicPostgresPoolManager is closed and cannot accept queries'
    );
    await expect(manager.reloadCredentials('postgresql://...')).rejects.toThrow(
      'DynamicPostgresPoolManager is closed and cannot accept queries'
    );
  });

  describe('US-17 Strict TLS 1.2+ & Anti-Downgrade SSL Guard', () => {
    it('should initialize pool with strict SSL configuration when sslOptions are provided', () => {
      let capturedConfig: any = null;
      const poolFactory = jest.fn().mockImplementation((config: any) => {
        capturedConfig = config;
        return mockInitialPool;
      });

      const sslOptions: PostgresSslOptions = {
        enabled: true,
        minVersion: 'TLSv1.3',
        ca: '-----BEGIN CERTIFICATE-----\nMOCK_ROOT_CA\n-----END CERTIFICATE-----',
      };

      const manager = new DynamicPostgresPoolManager({
        connectionString: 'postgresql://app_user:app_pass@flexible-pg.postgres.database.azure.com:5432/identity_prod',
        sslOptions,
        poolFactory,
      });

      expect(manager.getGeneration()).toBe(1);
      expect(manager.getSslOptions()).toEqual(sslOptions);
      expect(poolFactory).toHaveBeenCalledTimes(1);
      expect(capturedConfig.ssl).toBeDefined();
      expect(capturedConfig.ssl.rejectUnauthorized).toBe(true);
      expect(capturedConfig.ssl.minVersion).toBe('TLSv1.3');
      expect(capturedConfig.ssl.ca).toBe('-----BEGIN CERTIFICATE-----\nMOCK_ROOT_CA\n-----END CERTIFICATE-----');
    });

    it('should block initialization and throw SecurityConfigurationError if rejectUnauthorized is disabled', () => {
      const poolFactory = jest.fn();

      expect(() => {
        new DynamicPostgresPoolManager({
          poolConfig: {
            host: 'flexible-pg.postgres.database.azure.com',
            database: 'identity_prod',
            ssl: { rejectUnauthorized: false },
          },
          poolFactory,
        });
      }).toThrow(SecurityConfigurationError);

      expect(() => {
        new DynamicPostgresPoolManager({
          connectionString: 'postgresql://app_user:app_pass@flexible-pg.postgres.database.azure.com:5432/identity_prod?sslmode=no-verify',
          poolFactory,
        });
      }).toThrow(SecurityConfigurationError);

      expect(poolFactory).not.toHaveBeenCalled();
    });

    it('should inherit SSL security configuration during reloadCredentials with string connection', async () => {
      let reloadedConfig: any = null;
      const poolFactory = jest.fn().mockImplementation((config: any) => {
        reloadedConfig = config;
        return mockNewPool;
      });

      const sslOptions: PostgresSslOptions = {
        enabled: true,
        minVersion: 'TLSv1.2',
        ca: '-----BEGIN CERTIFICATE-----\nAZURE_DIGICERT_GLOBAL_ROOT_CA\n-----END CERTIFICATE-----',
      };

      const manager = new DynamicPostgresPoolManager({
        initialPool: mockInitialPool,
        sslOptions,
        poolFactory,
        drainGracePeriodMs: 50,
      });

      expect(manager.getGeneration()).toBe(1);

      await manager.reloadCredentials(
        'postgresql://rotated_user:new_rotated_pass@flexible-pg.postgres.database.azure.com:5432/identity_prod'
      );

      expect(manager.getGeneration()).toBe(2);
      expect(manager.getActivePool()).toBe(mockNewPool);
      expect(poolFactory).toHaveBeenCalledTimes(1);
      expect(reloadedConfig.ssl).toBeDefined();
      expect(reloadedConfig.ssl.rejectUnauthorized).toBe(true);
      expect(reloadedConfig.ssl.minVersion).toBe('TLSv1.2');
      expect(reloadedConfig.ssl.ca).toBe('-----BEGIN CERTIFICATE-----\nAZURE_DIGICERT_GLOBAL_ROOT_CA\n-----END CERTIFICATE-----');

      await manager.close();
    });

    it('should fail-safe and preserve active pool if reloadCredentials attempts an SSL downgrade', async () => {
      const poolFactory = jest.fn().mockImplementation(() => mockNewPool);

      const manager = new DynamicPostgresPoolManager({
        initialPool: mockInitialPool,
        poolFactory,
      });

      expect(manager.getGeneration()).toBe(1);

      // Attempt 1: Insecure sslmode in URL query
      await expect(
        manager.reloadCredentials(
          'postgresql://hacker_user:pass@flexible-pg:5432/identity_prod?sslmode=no-verify'
        )
      ).rejects.toThrow(SecurityConfigurationError);

      // Attempt 2: Explicit rejectUnauthorized: false in PoolConfig
      await expect(
        manager.reloadCredentials({
          host: 'flexible-pg',
          database: 'identity_prod',
          ssl: { rejectUnauthorized: false },
        })
      ).rejects.toThrow(SecurityConfigurationError);

      // Verify that candidate pool was NEVER created or swapped
      expect(poolFactory).not.toHaveBeenCalled();
      expect(manager.getGeneration()).toBe(1);
      expect(manager.getActivePool()).toBe(mockInitialPool);

      // Original pool continues to serve queries seamlessly
      const result = await manager.query('SELECT 1');
      expect(result.rows).toEqual([{ health_check: 1 }]);
      expect(mockInitialPool.end).not.toHaveBeenCalled();

      await manager.close();
    });
  });
});
