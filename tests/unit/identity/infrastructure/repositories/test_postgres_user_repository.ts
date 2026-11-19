import {
  PostgresUserRepository,
  DatabaseClient,
} from '../../../../../src/contexts/identity/infrastructure/persistence/repositories/user/repository';
import { User } from '../../../../../src/contexts/identity/domain/entities/user/aggregate';
import { Email } from '../../../../../src/contexts/identity/domain/value_objects/email/value';
import { TenantId } from '../../../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { UserDatabaseModel } from '../../../../../src/contexts/identity/infrastructure/persistence/models/user/model';

describe('Infrastructure Repository: PostgresUserRepository', () => {
  let mockDb: jest.Mocked<DatabaseClient>;
  let repository: PostgresUserRepository;

  const now = new Date('2026-11-19T00:00:00.000Z');

  beforeEach(() => {
    mockDb = {
      query: jest.fn(),
    };
    repository = new PostgresUserRepository(mockDb);
  });

  describe('save', () => {
    it('should execute INSERT/UPDATE with roles array column included in query and parameters', async () => {
      mockDb.query.mockResolvedValue({ rows: [], rowCount: 1 });

      const user = User.create({
        id: 'usr-101',
        email: Email.create('operator@system.local'),
        tenantId: TenantId.root(),
        passwordHash: '$2b$10$hashed_pw',
        roles: ['superadmin', 'auditor'],
      });

      await repository.save(user);

      expect(mockDb.query).toHaveBeenCalledTimes(1);
      const call = mockDb.query.mock.calls[0]!;
      const sql = call[0];
      const params = call[1]!;

      expect(sql).toContain('roles');
      expect(sql).toContain('INSERT INTO users');
      expect(sql).toContain('ON CONFLICT (id) DO UPDATE SET');
      expect(params).toHaveLength(7);
      expect(params[0]).toBe('usr-101');
      expect(params[1]).toBe('operator@system.local');
      expect(params[2]).toBe('$2b$10$hashed_pw');
      expect(params[3]).toBe('system');
      expect(params[4]).toEqual(['superadmin', 'auditor']); // roles array parameter ($5)
      expect(params[5]).toBeInstanceOf(Date);
      expect(params[6]).toBeInstanceOf(Date);
    });
  });

  describe('findByEmail', () => {
    it('should query with tenant isolation and return reconstructed User with roles', async () => {
      const dbRow: UserDatabaseModel = {
        id: 'usr-202',
        email: 'admin@angelpixel.io',
        password_hash: '$2b$10$hashed_admin',
        tenant_id: 'system',
        roles: ['superadmin'],
        created_at: now,
        updated_at: now,
      };

      mockDb.query.mockResolvedValue({ rows: [dbRow], rowCount: 1 });

      const email = Email.create('admin@angelpixel.io');
      const tenantId = TenantId.root();

      const result = await repository.findByEmail(email, tenantId);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, email, password_hash, tenant_id, roles, created_at, updated_at'),
        ['admin@angelpixel.io', 'system']
      );

      expect(result).not.toBeNull();
      expect(result!.getId()).toBe('usr-202');
      expect(result!.getRoles()).toEqual(['superadmin']);
      expect(result!.isSuperadmin()).toBe(true);
    });

    it('should return null when user is not found for the given email and tenantId', async () => {
      mockDb.query.mockResolvedValue({ rows: [], rowCount: 0 });

      const email = Email.create('missing@acme.com');
      const tenantId = TenantId.create('acme-corp');

      const result = await repository.findByEmail(email, tenantId);

      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('should query with tenant isolation and return User entity', async () => {
      const dbRow: UserDatabaseModel = {
        id: 'usr-303',
        email: 'user@acme.com',
        password_hash: '$2b$10$hashed_user',
        tenant_id: 'acme-corp',
        roles: ['member'],
        created_at: now,
        updated_at: now,
      };

      mockDb.query.mockResolvedValue({ rows: [dbRow], rowCount: 1 });

      const tenantId = TenantId.create('acme-corp');
      const result = await repository.findById('usr-303', tenantId);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, email, password_hash, tenant_id, roles, created_at, updated_at'),
        ['usr-303', 'acme-corp']
      );

      expect(result).not.toBeNull();
      expect(result!.getId()).toBe('usr-303');
      expect(result!.getRoles()).toEqual(['member']);
      expect(result!.isSuperadmin()).toBe(false);
    });

    it('should return null when user id is not found in the given tenant', async () => {
      mockDb.query.mockResolvedValue({ rows: [], rowCount: 0 });

      const tenantId = TenantId.create('acme-corp');
      const result = await repository.findById('non-existent-id', tenantId);

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should execute physical delete query scoped by tenantId and return true if rowCount > 0', async () => {
      mockDb.query.mockResolvedValue({ rows: [], rowCount: 1 });

      const tenantId = TenantId.create('acme-corp');
      const deleted = await repository.delete('usr-to-delete', tenantId);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM users\n      WHERE id = $1 AND tenant_id = $2;'),
        ['usr-to-delete', 'acme-corp']
      );
      expect(deleted).toBe(true);
    });

    it('should return false if no row was deleted', async () => {
      mockDb.query.mockResolvedValue({ rows: [], rowCount: 0 });

      const tenantId = TenantId.create('acme-corp');
      const deleted = await repository.delete('missing-user', tenantId);

      expect(deleted).toBe(false);
    });
  });

  describe('withClient', () => {
    it('should return a new PostgresUserRepository instance wrapping the transactional client', () => {
      const transactionalClient: DatabaseClient = { query: jest.fn() };
      const transactionalRepo = repository.withClient(transactionalClient);

      expect(transactionalRepo).toBeInstanceOf(PostgresUserRepository);
      expect(transactionalRepo).not.toBe(repository);
    });
  });
});
