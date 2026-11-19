import { UserMapper } from '../../../../../src/contexts/identity/infrastructure/persistence/mappers/user/mapper';
import { UserDatabaseModel } from '../../../../../src/contexts/identity/infrastructure/persistence/models/user/model';
import { User } from '../../../../../src/contexts/identity/domain/entities/user/aggregate';
import { Email } from '../../../../../src/contexts/identity/domain/value_objects/email/value';
import { TenantId } from '../../../../../src/contexts/identity/domain/value_objects/tenant_id/value';

describe('Infrastructure Mapper: UserMapper', () => {
  const now = new Date('2026-11-19T00:00:00.000Z');

  describe('toDomain (Reconstitution from Database)', () => {
    it('should reconstitute a standard user aggregate with default fallback role', () => {
      const rawModel: UserDatabaseModel = {
        id: 'user-standard-123',
        email: 'alice@acme.com',
        password_hash: '$2b$10$hashed_password_string_here_12345',
        tenant_id: 'acme-corp',
        created_at: now,
        updated_at: now,
      };

      const user = UserMapper.toDomain(rawModel);

      expect(user.getId()).toBe('user-standard-123');
      expect(user.getEmail().getValue()).toBe('alice@acme.com');
      expect(user.getTenantId().getValue()).toBe('acme-corp');
      expect(user.getPasswordHash()).toBe('$2b$10$hashed_password_string_here_12345');
      expect(user.getRoles()).toEqual(['member']);
      expect(user.hasRole('member')).toBe(true);
      expect(user.isSuperadmin()).toBe(false);
    });

    it('should correctly map explicit roles from PostgreSQL array', () => {
      const rawModel: UserDatabaseModel = {
        id: 'user-roles-456',
        email: 'manager@acme.com',
        password_hash: '$2b$10$hashed_password_string_here_12345',
        tenant_id: 'acme-corp',
        roles: ['admin', 'billing_manager'],
        created_at: now,
        updated_at: now,
      };

      const user = UserMapper.toDomain(rawModel);

      expect(user.getRoles()).toEqual(['admin', 'billing_manager']);
      expect(user.hasRole('admin')).toBe(true);
      expect(user.hasRole('billing_manager')).toBe(true);
      expect(user.hasRole('member')).toBe(false);
      expect(user.isSuperadmin()).toBe(false);
    });

    it('should reconstitute a Root Superadmin when tenant_id is system and roles contain superadmin', () => {
      const rawModel: UserDatabaseModel = {
        id: 'root-admin-001',
        email: 'admin@angelpixel.io',
        password_hash: '$2b$10$hashed_password_string_here_12345',
        tenant_id: 'system',
        roles: ['superadmin', 'member'],
        created_at: now,
        updated_at: now,
      };

      const user = UserMapper.toDomain(rawModel);

      expect(user.getTenantId().isRoot()).toBe(true);
      expect(user.hasRole('superadmin')).toBe(true);
      expect(user.isSuperadmin()).toBe(true);
    });

    it('should enforce Zero-Trust: a commercial tenant user with role superadmin is NOT a superadmin', () => {
      const rawModel: UserDatabaseModel = {
        id: 'fake-admin-999',
        email: 'imposter@acme.com',
        password_hash: '$2b$10$hashed_password_string_here_12345',
        tenant_id: 'acme-corp',
        roles: ['superadmin'],
        created_at: now,
        updated_at: now,
      };

      const user = UserMapper.toDomain(rawModel);

      expect(user.hasRole('superadmin')).toBe(true);
      expect(user.getTenantId().isRoot()).toBe(false);
      expect(user.isSuperadmin()).toBe(false);
    });

    it('should fallback to [member] when roles is null, undefined, or empty array', () => {
      const rawNullRoles: UserDatabaseModel = {
        id: 'user-null-roles',
        email: 'null@acme.com',
        password_hash: '$2b$10$hashed_password_string_here_12345',
        tenant_id: 'acme-corp',
        roles: null,
        created_at: now,
        updated_at: now,
      };

      const rawEmptyRoles: UserDatabaseModel = {
        id: 'user-empty-roles',
        email: 'empty@acme.com',
        password_hash: '$2b$10$hashed_password_string_here_12345',
        tenant_id: 'acme-corp',
        roles: [],
        created_at: now,
        updated_at: now,
      };

      expect(UserMapper.toDomain(rawNullRoles).getRoles()).toEqual(['member']);
      expect(UserMapper.toDomain(rawEmptyRoles).getRoles()).toEqual(['member']);
    });
  });

  describe('toPersistence (Transformation to Database Model)', () => {
    it('should transform user domain entity into database model including roles array', () => {
      const user = User.create({
        id: 'user-new-001',
        email: Email.create('new@acme.com'),
        tenantId: TenantId.create('acme-corp'),
        passwordHash: '$2b$10$hashed_password_string_here_12345',
        roles: ['auditor', 'viewer'],
      });

      const dbModel = UserMapper.toPersistence(user);

      expect(dbModel.id).toBe('user-new-001');
      expect(dbModel.email).toBe('new@acme.com');
      expect(dbModel.tenant_id).toBe('acme-corp');
      expect(dbModel.password_hash).toBe('$2b$10$hashed_password_string_here_12345');
      expect(dbModel.roles).toEqual(['auditor', 'viewer']);
      expect(dbModel.created_at).toBeInstanceOf(Date);
      expect(dbModel.updated_at).toBeInstanceOf(Date);
    });

    it('should maintain round-trip fidelity between domain and persistence', () => {
      const originalUser = User.reconstitute({
        id: 'round-trip-001',
        email: Email.create('roundtrip@angelpixel.io'),
        tenantId: TenantId.root(),
        passwordHash: '$2b$10$hashed_password_string_here_12345',
        roles: ['superadmin'],
        createdAt: now,
        updatedAt: now,
      });

      const dbModel = UserMapper.toPersistence(originalUser);
      const reconstitutedUser = UserMapper.toDomain(dbModel);

      expect(reconstitutedUser.getId()).toBe(originalUser.getId());
      expect(reconstitutedUser.getEmail().getValue()).toBe(originalUser.getEmail().getValue());
      expect(reconstitutedUser.getTenantId().getValue()).toBe(originalUser.getTenantId().getValue());
      expect(reconstitutedUser.getRoles()).toEqual(originalUser.getRoles());
      expect(reconstitutedUser.isSuperadmin()).toBe(true);
    });
  });
});
