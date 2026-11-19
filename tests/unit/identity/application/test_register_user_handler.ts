import { UserRepositoryPort } from '../../../../src/contexts/identity/application/ports/user/repository';
import { HashProviderPort } from '../../../../src/contexts/identity/application/ports/security/hash_provider';
import { TokenProviderPort } from '../../../../src/contexts/identity/application/ports/security/token_provider';
import { User } from '../../../../src/contexts/identity/domain/entities/user/aggregate';
import { Email } from '../../../../src/contexts/identity/domain/value_objects/email/value';
import { TenantId } from '../../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import {
  DomainValidationError,
  ConflictError,
} from '../../../../src/contexts/identity/domain/exceptions/user/error';
import { RegisterUserCommand } from '../../../../src/contexts/identity/application/commands/register_user/command';
import { RegisterUserCommandHandler } from '../../../../src/contexts/identity/application/commands/register_user/handler';

describe('Application Command Handler: RegisterUserCommandHandler', () => {
  let userRepository: jest.Mocked<UserRepositoryPort>;
  let hashProvider: jest.Mocked<HashProviderPort>;
  let tokenProvider: jest.Mocked<TokenProviderPort>;
  let handler: RegisterUserCommandHandler;

  const validCommand: RegisterUserCommand = {
    tenantId: 'acme-corp',
    email: 'user@acme.com',
    password: 'SecurePass123!',
  };

  beforeEach(() => {
    userRepository = {
      save: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue(null),
      findByEmail: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(true),
    };

    hashProvider = {
      hash: jest.fn().mockResolvedValue('$2b$10$hashedsecretpassword123'),
      compare: jest.fn().mockResolvedValue(true),
    };

    tokenProvider = {
      generateToken: jest.fn().mockResolvedValue('jwt-mock-access-token-123'),
      verifyToken: jest.fn(),
    };

    handler = new RegisterUserCommandHandler(userRepository, hashProvider, tokenProvider);
  });

  describe('Happy Path: Successful User Registration', () => {
    it('should orchestrate user creation, password hashing, persistence, and token issuance', async () => {
      const result = await handler.execute(validCommand);

      expect(userRepository.findByEmail).toHaveBeenCalledWith(
        expect.any(Email),
        expect.any(TenantId)
      );
      expect(hashProvider.hash).toHaveBeenCalledWith(validCommand.password);
      expect(userRepository.save).toHaveBeenCalledTimes(1);

      const savedUser = userRepository.save.mock.calls[0]![0];
      expect(savedUser).toBeInstanceOf(User);
      expect(savedUser.getEmail().getValue()).toBe('user@acme.com');
      expect(savedUser.getTenantId().getValue()).toBe('acme-corp');
      expect(savedUser.getPasswordHash()).toBe('$2b$10$hashedsecretpassword123');

      expect(tokenProvider.generateToken).toHaveBeenCalledWith({
        userId: savedUser.getId(),
        email: 'user@acme.com',
        tenantId: 'acme-corp',
        roles: ['member'],
        actorType: 'user',
      });

      expect(result).toEqual({
        userId: savedUser.getId(),
        email: 'user@acme.com',
        tenantId: 'acme-corp',
        roles: ['member'],
        accessToken: 'jwt-mock-access-token-123',
      });
    });

    it('should assign superadmin role and platform_operator actorType when registering in root tenant system', async () => {
      const rootCommand: RegisterUserCommand = {
        tenantId: 'system',
        email: 'admin@angelpixel.io',
        password: 'AdminSuperPassword2026!',
      };

      const result = await handler.execute(rootCommand);

      expect(result.tenantId).toBe('system');
      expect(result.roles).toEqual(['superadmin', 'member']);
      expect(tokenProvider.generateToken).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'system',
          roles: ['superadmin', 'member'],
          actorType: 'platform_operator',
        })
      );
    });

    it('should reject registration when superadmin role is requested in a non-root tenant (Defense-in-Depth)', async () => {
      const maliciousCommand: RegisterUserCommand = {
        tenantId: 'acme-corp',
        email: 'hacker@acme.com',
        password: 'Password123!',
        roles: ['superadmin'],
      };

      await expect(handler.execute(maliciousCommand)).rejects.toThrow(DomainValidationError);
      await expect(handler.execute(maliciousCommand)).rejects.toThrow(
        'Role "superadmin" can only be assigned within the root tenant ("system")'
      );
    });
  });

  describe('Conflict Scenario: Duplicate User in Same Tenant', () => {
    it('should throw ConflictError if user with same email exists in the same tenant', async () => {
      const existingUser = User.create({
        id: 'existing-id-1',
        email: Email.create('user@acme.com'),
        tenantId: TenantId.create('acme-corp'),
        passwordHash: '$2b$10$existinghash',
      });

      userRepository.findByEmail.mockResolvedValue(existingUser);

      await expect(handler.execute(validCommand)).rejects.toThrow(ConflictError);

      expect(hashProvider.hash).not.toHaveBeenCalled();
      expect(userRepository.save).not.toHaveBeenCalled();
      expect(tokenProvider.generateToken).not.toHaveBeenCalled();
    });
  });

  describe('Password Complexity Validation', () => {
    it('should throw DomainValidationError if password is shorter than 8 characters', async () => {
      const weakCommand: RegisterUserCommand = {
        tenantId: 'acme-corp',
        email: 'user@acme.com',
        password: '123',
      };

      await expect(handler.execute(weakCommand)).rejects.toThrow(DomainValidationError);
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('should throw DomainValidationError if password is empty or whitespace', async () => {
      const emptyPasswordCommand: RegisterUserCommand = {
        tenantId: 'acme-corp',
        email: 'user@acme.com',
        password: '   ',
      };

      await expect(handler.execute(emptyPasswordCommand)).rejects.toThrow(DomainValidationError);
      expect(userRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('Multi-tenant Isolation', () => {
    it('should allow registration of same email if it belongs to a different tenant', async () => {
      userRepository.findByEmail.mockResolvedValue(null);

      const result = await handler.execute({
        tenantId: 'other-corp',
        email: 'user@acme.com',
        password: 'SecurePass123!',
      });

      expect(result.tenantId).toBe('other-corp');
      expect(userRepository.save).toHaveBeenCalledTimes(1);
    });
  });
});

