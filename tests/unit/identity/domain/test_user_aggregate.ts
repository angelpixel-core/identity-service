import { Email } from '../../../../src/contexts/identity/domain/value_objects/email/value';
import { TenantId } from '../../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { User } from '../../../../src/contexts/identity/domain/entities/user/aggregate';
import { DomainValidationError } from '../../../../src/contexts/identity/domain/exceptions/user/error';

describe('Aggregate Root: User', () => {
  const validId = 'usr-12345678-abcd';
  const validEmail = Email.create('user@acme.com');
  const validTenantId = TenantId.create('acme-corp');
  const validPasswordHash = '$2b$10$hashedpasswordstringforsecuretesting123';

  describe('User Creation (Genesis / Factory)', () => {
    it('should successfully create a new User aggregate with valid properties', () => {
      const user = User.create({
        id: validId,
        email: validEmail,
        tenantId: validTenantId,
        passwordHash: validPasswordHash,
      });

      expect(user.getId()).toBe(validId);
      expect(user.getEmail().equals(validEmail)).toBe(true);
      expect(user.getTenantId().equals(validTenantId)).toBe(true);
      expect(user.getPasswordHash()).toBe(validPasswordHash);
      expect(user.hasLocalPassword()).toBe(true);
      expect(user.getCreatedAt()).toBeInstanceOf(Date);
      expect(user.getUpdatedAt()).toBeInstanceOf(Date);
    });

    it('should successfully reconstitute an existing User from persistence data', () => {
      const pastDate = new Date('2026-01-01T00:00:00.000Z');
      const user = User.reconstitute({
        id: validId,
        email: validEmail,
        tenantId: validTenantId,
        passwordHash: validPasswordHash,
        createdAt: pastDate,
        updatedAt: pastDate,
      });

      expect(user.getId()).toBe(validId);
      expect(user.getCreatedAt()).toEqual(pastDate);
      expect(user.getUpdatedAt()).toEqual(pastDate);
    });

    it('should create a federated User with unmatchable password hash and auto-generated ID', () => {
      const federatedUser = User.createFederatedUser({
        email: validEmail,
        tenantId: validTenantId,
      });

      expect(federatedUser.getId()).toBeDefined();
      expect(federatedUser.getId().length).toBeGreaterThan(10);
      expect(federatedUser.getEmail().equals(validEmail)).toBe(true);
      expect(federatedUser.getTenantId().equals(validTenantId)).toBe(true);
      expect(federatedUser.getPasswordHash()).toContain('$2b$12$FEDERATED_NO_LOCAL_PASSWORD_');
      expect(federatedUser.hasLocalPassword()).toBe(false);
    });

    it('should create a federated User with custom ID if provided', () => {
      const customId = 'usr-custom-federated-999';
      const federatedUser = User.createFederatedUser({
        id: customId,
        email: validEmail,
        tenantId: validTenantId,
      });

      expect(federatedUser.getId()).toBe(customId);
      expect(federatedUser.hasLocalPassword()).toBe(false);
    });
  });

  describe('Invariants and Validation', () => {
    it('should throw DomainValidationError if id is empty or whitespace', () => {
      expect(() =>
        User.create({
          id: '',
          email: validEmail,
          tenantId: validTenantId,
          passwordHash: validPasswordHash,
        })
      ).toThrow(DomainValidationError);

      expect(() =>
        User.create({
          id: '   ',
          email: validEmail,
          tenantId: validTenantId,
          passwordHash: validPasswordHash,
        })
      ).toThrow(DomainValidationError);
    });

    it('should throw DomainValidationError if passwordHash is empty or whitespace', () => {
      expect(() =>
        User.create({
          id: validId,
          email: validEmail,
          tenantId: validTenantId,
          passwordHash: '',
        })
      ).toThrow(DomainValidationError);

      expect(() =>
        User.create({
          id: validId,
          email: validEmail,
          tenantId: validTenantId,
          passwordHash: '   ',
        })
      ).toThrow(DomainValidationError);
    });
  });

  describe('Domain Business Methods', () => {
    it('should update password hash and refresh updatedAt timestamp', () => {
      const user = User.create({
        id: validId,
        email: validEmail,
        tenantId: validTenantId,
        passwordHash: validPasswordHash,
      });

      const originalUpdatedAt = user.getUpdatedAt().getTime();
      const newHash = '$2b$10$newsecurelyhashedpasswordstring456';

      user.changePassword(newHash);

      expect(user.getPasswordHash()).toBe(newHash);
      expect(user.getUpdatedAt().getTime()).toBeGreaterThanOrEqual(originalUpdatedAt);
    });

    it('should throw DomainValidationError when attempting to change password with empty hash', () => {
      const user = User.create({
        id: validId,
        email: validEmail,
        tenantId: validTenantId,
        passwordHash: validPasswordHash,
      });

      expect(() => user.changePassword('')).toThrow(DomainValidationError);
      expect(() => user.changePassword('   ')).toThrow(DomainValidationError);
    });
  });
});

