import { User } from '../../../../src/contexts/identity/domain/entities/user/aggregate';
import { Email } from '../../../../src/contexts/identity/domain/value_objects/email/value';
import { TenantId } from '../../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { UserRepositoryPort } from '../../../../src/contexts/identity/application/ports/user/repository';
// @ts-expect-error - Module will be implemented in the green phase
import { PostgresUserRepository, DatabaseClient } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/user/repository';

describe('Infrastructure Persistence: PostgresUserRepository', () => {
  let mockDbClient: {
    query: jest.Mock;
  };
  let repository: UserRepositoryPort;

  const tenantAcme = TenantId.create('acme-corp');
  const tenantBeta = TenantId.create('beta-corp');
  const userEmail = Email.create('developer@acme.com');

  const validUser = User.create({
    id: 'user-uuid-1001',
    email: userEmail,
    passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz01234567890123456789012345',
    tenantId: tenantAcme,
  });

  const rawUserRow = {
    id: validUser.getId(),
    email: validUser.getEmail().getValue(),
    password_hash: validUser.getPasswordHash(),
    tenant_id: validUser.getTenantId().getValue(),
    created_at: validUser.getCreatedAt(),
    updated_at: validUser.getUpdatedAt(),
  };

  beforeEach(() => {
    mockDbClient = {
      query: jest.fn(),
    };
    repository = new PostgresUserRepository(mockDbClient as unknown as DatabaseClient);
  });

  describe('save', () => {
    it('should persist a new user aggregate using parameterized SQL query', async () => {
      mockDbClient.query.mockResolvedValueOnce({ rows: [] });

      await repository.save(validUser);

      expect(mockDbClient.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDbClient.query.mock.calls[0];

      expect(sql).toContain('INSERT INTO users');
      expect(sql).toContain('tenant_id');
      expect(params).toEqual([
        validUser.getId(),
        validUser.getEmail().getValue(),
        validUser.getPasswordHash(),
        validUser.getTenantId().getValue(),
        validUser.getCreatedAt(),
        validUser.getUpdatedAt(),
      ]);
    });

    it('should propagate database query errors during save', async () => {
      mockDbClient.query.mockRejectedValueOnce(new Error('Connection to database failed'));

      await expect(repository.save(validUser)).rejects.toThrow('Connection to database failed');
    });
  });

  describe('findByEmail (Multi-Tenant Segregation)', () => {
    it('should query by both email and tenant_id to guarantee tenant isolation', async () => {
      mockDbClient.query.mockResolvedValueOnce({ rows: [rawUserRow] });

      const foundUser = await repository.findByEmail(userEmail, tenantAcme);

      expect(mockDbClient.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDbClient.query.mock.calls[0];

      expect(sql).toContain('SELECT');
      expect(sql).toContain('WHERE email = $1 AND tenant_id = $2');
      expect(params).toEqual([userEmail.getValue(), tenantAcme.getValue()]);

      expect(foundUser).not.toBeNull();
      expect(foundUser?.getId()).toBe(validUser.getId());
      expect(foundUser?.getEmail().getValue()).toBe(userEmail.getValue());
      expect(foundUser?.getTenantId().getValue()).toBe(tenantAcme.getValue());
    });

    it('should return null when no user exists for the given email and tenant_id', async () => {
      mockDbClient.query.mockResolvedValueOnce({ rows: [] });

      const foundUser = await repository.findByEmail(userEmail, tenantAcme);

      expect(foundUser).toBeNull();
    });

    it('should not return a user if the email matches but belongs to a different tenant', async () => {
      mockDbClient.query.mockResolvedValueOnce({ rows: [] });

      const foundUser = await repository.findByEmail(userEmail, tenantBeta);

      const [, params] = mockDbClient.query.mock.calls[0];
      expect(params).toEqual([userEmail.getValue(), tenantBeta.getValue()]);
      expect(foundUser).toBeNull();
    });
  });

  describe('findById (Multi-Tenant Segregation)', () => {
    it('should query by both id and tenant_id to prevent cross-tenant record leakage', async () => {
      mockDbClient.query.mockResolvedValueOnce({ rows: [rawUserRow] });

      const foundUser = await repository.findById(validUser.getId(), tenantAcme);

      expect(mockDbClient.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDbClient.query.mock.calls[0];

      expect(sql).toContain('SELECT');
      expect(sql).toContain('WHERE id = $1 AND tenant_id = $2');
      expect(params).toEqual([validUser.getId(), tenantAcme.getValue()]);

      expect(foundUser).not.toBeNull();
      expect(foundUser?.getId()).toBe(validUser.getId());
      expect(foundUser?.getTenantId().getValue()).toBe(tenantAcme.getValue());
    });

    it('should return null when no record matches the id and tenant_id tuple', async () => {
      mockDbClient.query.mockResolvedValueOnce({ rows: [] });

      const foundUser = await repository.findById('unknown-id', tenantAcme);

      expect(foundUser).toBeNull();
    });
  });
});
