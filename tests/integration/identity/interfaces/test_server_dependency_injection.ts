import request from 'supertest';
import { createApp, AppDependencies } from '../../../../interfaces/http/server';
import { TenantTransactionRunnerPort } from '../../../../src/contexts/identity/application/ports/database/tenant_transaction_runner';
import { TenantSessionContext } from '../../../../src/contexts/identity/domain/value_objects/tenant_session_context/value';
import { UserRepositoryPort } from '../../../../src/contexts/identity/application/ports/user/repository';
import { ClientApplicationRepositoryPort } from '../../../../src/contexts/identity/domain/ports/client_application_repository_port';
import { DatabaseClient } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/user/repository';

describe('Server Dependency Injection & Container Integration', () => {
  it('should initialize default in-memory dependencies and store them in app.locals', () => {
    const app = createApp();

    expect(app.locals.userRepository).toBeDefined();
    expect(app.locals.clientRepository).toBeDefined();
    expect(typeof app.locals.userRepository.save).toBe('function');
    expect(typeof app.locals.clientRepository.findByClientId).toBe('function');
    // In test environment without DATABASE_URL, runner is not bound by default
    expect(app.locals.transactionRunner).toBeUndefined();
  });

  it('should accept and wire an injected TenantTransactionRunnerPort into app.locals', async () => {
    let runnerCalledWithTenant = '';
    const mockClient: DatabaseClient = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    };

    const mockRunner: TenantTransactionRunnerPort = {
      runInTenantContext: jest.fn().mockImplementation(async (tenant, callback) => {
        const session = tenant instanceof TenantSessionContext
          ? tenant
          : TenantSessionContext.create(tenant);
        runnerCalledWithTenant = session.getTenantIdValue();
        return callback(mockClient, session);
      }),
    };

    const deps: AppDependencies = {
      transactionRunner: mockRunner,
    };

    const app = createApp(deps);

    expect(app.locals.transactionRunner).toBe(mockRunner);

    // Verify runner execution through container
    const runner: TenantTransactionRunnerPort = app.locals.transactionRunner;
    const result = await runner.runInTenantContext('tenant-di-123', async (client, session) => {
      expect(session.getTenantId().getValue()).toBe('tenant-di-123');
      expect(client).toBe(mockClient);
      return 'transaction-executed-successfully';
    });

    expect(result).toBe('transaction-executed-successfully');
    expect(runnerCalledWithTenant).toBe('tenant-di-123');
    expect(mockRunner.runInTenantContext).toHaveBeenCalledTimes(1);
  });

  it('should wire custom repositories into app.locals when provided in deps', () => {
    const mockUserRepo: Partial<UserRepositoryPort> = {
      save: jest.fn(),
      findByEmail: jest.fn(),
      findById: jest.fn(),
    };
    const mockClientRepo: Partial<ClientApplicationRepositoryPort> = {
      findByClientId: jest.fn(),
      save: jest.fn(),
    };

    const app = createApp({
      userRepository: mockUserRepo as UserRepositoryPort,
      clientRepository: mockClientRepo as ClientApplicationRepositoryPort,
    });

    expect(app.locals.userRepository).toBe(mockUserRepo);
    expect(app.locals.clientRepository).toBe(mockClientRepo);
  });

  it('should maintain HTTP routes operation intact with custom dependency injection', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/v1/auth/register')
      .set('X-Tenant-ID', 'tenant-alpha')
      .send({
        email: 'container.test@example.com',
        password: 'ValidPassword123!',
      });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('userId');
    expect(response.body.email).toBe('container.test@example.com');
  });
});
