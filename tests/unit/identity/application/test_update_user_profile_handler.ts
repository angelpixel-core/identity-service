import { UserRepositoryPort } from '../../../../src/contexts/identity/application/ports/user/repository';
import { CacheProviderPort } from '../../../../src/contexts/identity/application/ports/cache/cache_provider';
import { User } from '../../../../src/contexts/identity/domain/entities/user/aggregate';
import { Email } from '../../../../src/contexts/identity/domain/value_objects/email/value';
import { TenantId } from '../../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { UpdateUserProfileCommandHandler } from '../../../../src/contexts/identity/application/commands/update_user_profile/handler';
import { DomainValidationError } from '../../../../src/contexts/identity/domain/exceptions/user/error';

describe('Application Command Handler: UpdateUserProfileCommandHandler', () => {
  let userRepository: jest.Mocked<UserRepositoryPort>;
  let cacheProvider: jest.Mocked<CacheProviderPort>;
  let handler: UpdateUserProfileCommandHandler;

  const tenantAcme = TenantId.create('acme-corp');
  const userEmail = Email.create('alice@acme.com');
  const userId = 'user-uuid-1001';

  let existingUser: User;

  beforeEach(() => {
    existingUser = User.create({
      id: userId,
      email: userEmail,
      passwordHash: '$2b$10$hashedsecretpassword123',
      tenantId: tenantAcme,
    });

    userRepository = {
      save: jest.fn(),
      findById: jest.fn(),
      findByEmail: jest.fn(),
      delete: jest.fn(),
    };

    cacheProvider = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
    };

    handler = new UpdateUserProfileCommandHandler(userRepository, cacheProvider);
  });

  it('should update user email, save aggregate, invalidate cache, and return updated DTO', async () => {
    userRepository.findById.mockResolvedValueOnce(existingUser);
    userRepository.save.mockResolvedValueOnce();
    cacheProvider.delete.mockResolvedValueOnce();

    const result = await handler.execute({
      userId,
      tenantId: 'acme-corp',
      email: 'alice.updated@acme.com',
    });

    expect(userRepository.findById).toHaveBeenCalledWith(userId, tenantAcme);
    expect(userRepository.save).toHaveBeenCalledWith(existingUser);
    expect(cacheProvider.delete).toHaveBeenCalledWith(`user_profile:acme-corp:${userId}`);
    expect(result.email).toBe('alice.updated@acme.com');
    expect(result.id).toBe(userId);
    expect(result.tenantId).toBe('acme-corp');
  });

  it('should execute successfully without cache provider if not injected', async () => {
    const handlerNoCache = new UpdateUserProfileCommandHandler(userRepository);
    userRepository.findById.mockResolvedValueOnce(existingUser);
    userRepository.save.mockResolvedValueOnce();

    const result = await handlerNoCache.execute({
      userId,
      tenantId: 'acme-corp',
      email: 'alice.updated@acme.com',
    });

    expect(result.email).toBe('alice.updated@acme.com');
    expect(cacheProvider.delete).not.toHaveBeenCalled();
  });

  it('should throw an error when user is not found in the given tenant', async () => {
    userRepository.findById.mockResolvedValueOnce(null);

    await expect(
      handler.execute({
        userId: 'non-existent-id',
        tenantId: 'acme-corp',
        email: 'new@acme.com',
      })
    ).rejects.toThrow('User not found in tenant acme-corp');

    expect(userRepository.save).not.toHaveBeenCalled();
    expect(cacheProvider.delete).not.toHaveBeenCalled();
  });

  it('should throw DomainValidationError if userId is empty', async () => {
    await expect(
      handler.execute({
        userId: '',
        tenantId: 'acme-corp',
        email: 'new@acme.com',
      })
    ).rejects.toThrow(DomainValidationError);
  });

  it('should throw DomainValidationError if tenantId is empty', async () => {
    await expect(
      handler.execute({
        userId,
        tenantId: '',
        email: 'new@acme.com',
      })
    ).rejects.toThrow(DomainValidationError);
  });

  it('should throw DomainValidationError if updated email format is invalid', async () => {
    userRepository.findById.mockResolvedValueOnce(existingUser);

    await expect(
      handler.execute({
        userId,
        tenantId: 'acme-corp',
        email: 'invalid-email-format',
      })
    ).rejects.toThrow(DomainValidationError);

    expect(userRepository.save).not.toHaveBeenCalled();
  });
});
