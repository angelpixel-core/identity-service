import { UserRepositoryPort } from '../../../../src/contexts/identity/application/ports/user/repository';
import { CacheProviderPort } from '../../../../src/contexts/identity/application/ports/cache/cache_provider';
import { User } from '../../../../src/contexts/identity/domain/entities/user/aggregate';
import { Email } from '../../../../src/contexts/identity/domain/value_objects/email/value';
import { TenantId } from '../../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { GetUserProfileQuery } from '../../../../src/contexts/identity/application/queries/get_user_profile/query';
import { GetUserProfileQueryHandler } from '../../../../src/contexts/identity/application/queries/get_user_profile/handler';
import { UserProfileDTO } from '../../../../src/contexts/identity/application/dtos/user_profile/dto';

describe('Application Query Handler: GetUserProfileQueryHandler', () => {
  let userRepository: jest.Mocked<UserRepositoryPort>;
  let cacheProvider: jest.Mocked<CacheProviderPort>;
  let handler: GetUserProfileQueryHandler;

  const tenantAcme = TenantId.create('acme-corp');
  const userEmail = Email.create('alice@acme.com');
  const userId = 'user-uuid-1001';

  const existingUser = User.create({
    id: userId,
    email: userEmail,
    passwordHash: '$2b$10$hashedsecretpassword123',
    tenantId: tenantAcme,
  });

  const query: GetUserProfileQuery = {
    userId: userId,
    tenantId: 'acme-corp',
  };

  const expectedCacheKey = `user_profile:acme-corp:${userId}`;

  beforeEach(() => {
    userRepository = {
      save: jest.fn(),
      findById: jest.fn(),
      findByEmail: jest.fn(),
    };

    cacheProvider = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
    };

    handler = new GetUserProfileQueryHandler(userRepository, cacheProvider, 300);
  });

  describe('Cache Miss Scenario (Database fetch and cache population)', () => {
    it('should query PostgreSQL, populate cache with TTL, and return sanitized UserProfileDTO', async () => {
      cacheProvider.get.mockResolvedValueOnce(null);
      userRepository.findById.mockResolvedValueOnce(existingUser);

      const result: UserProfileDTO = await handler.execute(query);

      expect(cacheProvider.get).toHaveBeenCalledWith(expectedCacheKey);
      expect(userRepository.findById).toHaveBeenCalledWith(userId, tenantAcme);
      expect(cacheProvider.set).toHaveBeenCalledWith(
        expectedCacheKey,
        expect.objectContaining({
          id: userId,
          email: 'alice@acme.com',
          tenantId: 'acme-corp',
        }),
        300
      );

      expect(result).toEqual({
        id: userId,
        email: 'alice@acme.com',
        tenantId: 'acme-corp',
        createdAt: existingUser.getCreatedAt(),
        updatedAt: existingUser.getUpdatedAt(),
      });
      // Ensure password hash is completely absent from DTO
      expect(result).not.toHaveProperty('passwordHash');
    });
  });

  describe('Cache Hit Scenario (Instant response from cache)', () => {
    it('should return cached UserProfileDTO without hitting the database repository', async () => {
      const cachedProfile: UserProfileDTO = {
        id: userId,
        email: 'alice@acme.com',
        tenantId: 'acme-corp',
        createdAt: new Date('2026-11-04T00:00:00.000Z'),
        updatedAt: new Date('2026-11-04T00:00:00.000Z'),
      };

      cacheProvider.get.mockResolvedValueOnce(cachedProfile);

      const result: UserProfileDTO = await handler.execute(query);

      expect(cacheProvider.get).toHaveBeenCalledWith(expectedCacheKey);
      expect(userRepository.findById).not.toHaveBeenCalled();
      expect(cacheProvider.set).not.toHaveBeenCalled();
      expect(result).toEqual(cachedProfile);
    });
  });

  describe('User Not Found Scenario', () => {
    it('should throw an error when user does not exist in the database upon cache miss', async () => {
      cacheProvider.get.mockResolvedValueOnce(null);
      userRepository.findById.mockResolvedValueOnce(null);

      await expect(handler.execute(query)).rejects.toThrow('User not found in tenant acme-corp');
      expect(cacheProvider.set).not.toHaveBeenCalled();
    });
  });
});

