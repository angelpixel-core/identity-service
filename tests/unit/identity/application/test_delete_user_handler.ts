// 4. Capa de Aplicación (Puertos y Casos de Uso)
import type { UserRepositoryPort } from '@identity/application/ports/user/repository';
import type { CacheProviderPort } from '@identity/application/ports/cache/cache_provider';
import { DeleteUserCommandHandler } from '@identity/application/commands/delete_user/handler';

// 5. Capa de Dominio (Entidades, Value Objects y Excepciones)
import { User } from '@identity/domain/entities/user/aggregate';
import { Email } from '@identity/domain/value_objects/email/value';
import { TenantId } from '@identity/domain/value_objects/tenant_id/value';
import { DomainValidationError } from '@identity/domain/exceptions/user/error';

describe('Application Command Handler: DeleteUserCommandHandler (US-06 / GDPR Teardown)', () => {
  let userRepository: jest.Mocked<UserRepositoryPort>;
  let cacheProvider: jest.Mocked<CacheProviderPort>;
  let handler: DeleteUserCommandHandler;

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

    handler = new DeleteUserCommandHandler(userRepository, cacheProvider);
  });

  it('should find user, delete physical entity, and evict Redis cache key', async () => {
    userRepository.findById.mockResolvedValueOnce(existingUser);
    userRepository.delete.mockResolvedValueOnce(true);
    cacheProvider.delete.mockResolvedValueOnce();

    await handler.execute({
      userId,
      tenantId: 'acme-corp',
    });

    expect(userRepository.findById).toHaveBeenCalledWith(userId, tenantAcme);
    expect(userRepository.delete).toHaveBeenCalledWith(userId, tenantAcme);
    expect(cacheProvider.delete).toHaveBeenCalledWith(`user_profile:acme-corp:${userId}`);
  });

  it('should execute successfully without cache provider if not injected', async () => {
    const handlerNoCache = new DeleteUserCommandHandler(userRepository);
    userRepository.findById.mockResolvedValueOnce(existingUser);
    userRepository.delete.mockResolvedValueOnce(true);

    await handlerNoCache.execute({
      userId,
      tenantId: 'acme-corp',
    });

    expect(userRepository.findById).toHaveBeenCalledWith(userId, tenantAcme);
    expect(userRepository.delete).toHaveBeenCalledWith(userId, tenantAcme);
    expect(cacheProvider.delete).not.toHaveBeenCalled();
  });

  it('should throw an error when user is not found in the given tenant (Zero-Trust Anti-Enumeration)', async () => {
    userRepository.findById.mockResolvedValueOnce(null);

    await expect(
      handler.execute({
        userId: 'non-existent-user-id',
        tenantId: 'acme-corp',
      })
    ).rejects.toThrow('User not found in tenant acme-corp');

    expect(userRepository.delete).not.toHaveBeenCalled();
    expect(cacheProvider.delete).not.toHaveBeenCalled();
  });

  it('should throw DomainValidationError if userId is empty or whitespace', async () => {
    await expect(
      handler.execute({
        userId: '   ',
        tenantId: 'acme-corp',
      })
    ).rejects.toThrow(DomainValidationError);

    expect(userRepository.findById).not.toHaveBeenCalled();
  });

  it('should throw DomainValidationError if tenantId is empty or whitespace', async () => {
    await expect(
      handler.execute({
        userId,
        tenantId: '',
      })
    ).rejects.toThrow(DomainValidationError);

    expect(userRepository.findById).not.toHaveBeenCalled();
  });

  it('should throw DomainValidationError if tenantId contains illegal characters', async () => {
    await expect(
      handler.execute({
        userId,
        tenantId: 'invalid tenant with spaces!',
      })
    ).rejects.toThrow(DomainValidationError);

    expect(userRepository.findById).not.toHaveBeenCalled();
  });
});
