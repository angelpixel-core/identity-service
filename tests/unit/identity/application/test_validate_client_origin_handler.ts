import { ClientApplicationRepositoryPort } from '../../../../src/contexts/identity/domain/ports/client_application_repository_port';
import { CacheProviderPort } from '../../../../src/contexts/identity/application/ports/cache/cache_provider';
import { ClientApplication } from '../../../../src/contexts/identity/domain/entities/client_application/aggregate';
import { ClientId } from '../../../../src/contexts/identity/domain/value_objects/client_id/value';
import { OriginDomain } from '../../../../src/contexts/identity/domain/value_objects/origin_domain/value';
import { ValidateClientOriginQueryHandler } from '../../../../src/contexts/identity/application/queries/validate_client_origin/handler';
import { CachedRegisteredClientDTO } from '../../../../src/contexts/identity/application/dtos/client_validation/dto';

describe('Application Query Handler: ValidateClientOriginQueryHandler', () => {
  let clientRepository: jest.Mocked<ClientApplicationRepositoryPort>;
  let cacheProvider: jest.Mocked<CacheProviderPort>;
  let handler: ValidateClientOriginQueryHandler;

  const clientIdVo = ClientId.create('portfolio-web-spa');
  const expectedCacheKey = 'registered_client:portfolio-web-spa';

  const activeConfidentialClient = ClientApplication.create({
    id: 'client-uuid-9001',
    clientId: ClientId.create('harvis-core-backend'),
    clientSecretHash: '$2b$10$supersecrethashvalue123456',
    clientName: 'Harvis Core Backend',
    clientType: 'confidential',
    allowedOrigins: [OriginDomain.create('https://harvis.angelsolutions.io')],
    redirectUris: ['https://harvis.angelsolutions.io/api/auth/callback'],
    allowedGrantTypes: ['authorization_code', 'refresh_token', 'client_credentials'],
    scopes: ['openid', 'profile', 'email', 'identity:read'],
    isActive: true,
  });

  const activePublicClient = ClientApplication.create({
    id: 'client-uuid-9002',
    clientId: clientIdVo,
    clientName: 'Portfolio Web SPA',
    clientType: 'public',
    allowedOrigins: [
      OriginDomain.create('https://portfolio.angelsolutions.io'),
      OriginDomain.create('http://localhost:5173'),
    ],
    redirectUris: ['https://portfolio.angelsolutions.io/callback'],
    allowedGrantTypes: ['authorization_code', 'refresh_token'],
    scopes: ['openid', 'profile', 'email'],
    isActive: true,
  });

  beforeEach(() => {
    clientRepository = {
      save: jest.fn(),
      findByClientId: jest.fn(),
    };

    cacheProvider = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
    };

    handler = new ValidateClientOriginQueryHandler(clientRepository, cacheProvider, 300);
  });

  describe('Cache Miss Scenario (Database fetch and sanitized cache population)', () => {
    it('should query repository, cache snapshot without clientSecretHash, and authorize valid origin', async () => {
      cacheProvider.get.mockResolvedValueOnce(null);
      clientRepository.findByClientId.mockResolvedValueOnce(activeConfidentialClient);

      const result = await handler.execute({
        clientId: 'harvis-core-backend',
        origin: 'https://harvis.angelsolutions.io',
      });

      expect(cacheProvider.get).toHaveBeenCalledWith('registered_client:harvis-core-backend');
      expect(clientRepository.findByClientId).toHaveBeenCalledTimes(1);
      expect(cacheProvider.set).toHaveBeenCalledWith(
        'registered_client:harvis-core-backend',
        expect.objectContaining({
          id: 'client-uuid-9001',
          clientId: 'harvis-core-backend',
          clientType: 'confidential',
          allowedOrigins: ['https://harvis.angelsolutions.io'],
        }),
        300
      );

      // Verify secret hash is never stored in cache
      const cachedPayload = cacheProvider.set.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(cachedPayload).not.toHaveProperty('clientSecretHash');

      expect(result).toEqual({
        authorized: true,
        clientId: 'harvis-core-backend',
        clientName: 'Harvis Core Backend',
        clientType: 'confidential',
        allowedOrigins: ['https://harvis.angelsolutions.io'],
        redirectUris: ['https://harvis.angelsolutions.io/api/auth/callback'],
        allowedGrantTypes: ['authorization_code', 'refresh_token', 'client_credentials'],
        scopes: ['openid', 'profile', 'email', 'identity:read'],
      });
    });
  });

  describe('Cache Hit Scenario (Zero database queries)', () => {
    it('should validate origin directly from cached snapshot without hitting the database', async () => {
      const cachedSnapshot: CachedRegisteredClientDTO = {
        id: 'client-uuid-9002',
        clientId: 'portfolio-web-spa',
        clientName: 'Portfolio Web SPA',
        clientType: 'public',
        allowedOrigins: ['https://portfolio.angelsolutions.io', 'http://localhost:5173'],
        redirectUris: ['https://portfolio.angelsolutions.io/callback'],
        allowedGrantTypes: ['authorization_code', 'refresh_token'],
        scopes: ['openid', 'profile', 'email'],
        isActive: true,
      };

      cacheProvider.get.mockResolvedValueOnce(cachedSnapshot);

      const result = await handler.execute({
        clientId: 'portfolio-web-spa',
        origin: 'https://portfolio.angelsolutions.io/',
      });

      expect(cacheProvider.get).toHaveBeenCalledWith(expectedCacheKey);
      expect(clientRepository.findByClientId).not.toHaveBeenCalled();
      expect(cacheProvider.set).not.toHaveBeenCalled();
      expect(result.authorized).toBe(true);
      expect(result.clientId).toBe('portfolio-web-spa');
      expect(result.clientType).toBe('public');
    });
  });

  describe('Origin & Lifecycle Rejection Scenarios', () => {
    it('should reject an unauthorized origin with errorCode "unauthorized_client_origin"', async () => {
      cacheProvider.get.mockResolvedValueOnce(null);
      clientRepository.findByClientId.mockResolvedValueOnce(activePublicClient);

      const result = await handler.execute({
        clientId: 'portfolio-web-spa',
        origin: 'https://evil-phishing.org',
      });

      expect(result).toEqual({
        authorized: false,
        clientId: 'portfolio-web-spa',
        clientType: 'public',
        errorCode: 'unauthorized_client_origin',
        message: 'Origin https://evil-phishing.org is not authorized for client portfolio-web-spa.',
      });
    });

    it('should reject a deactivated client with errorCode "client_deactivated"', async () => {
      const deactivatedClient = ClientApplication.create({
        id: 'client-uuid-9003',
        clientId: ClientId.create('legacy-portal-app'),
        clientName: 'Legacy Portal App',
        clientType: 'public',
        allowedOrigins: [OriginDomain.create('https://legacy.angelsolutions.io')],
        redirectUris: [],
        allowedGrantTypes: ['authorization_code'],
        scopes: ['openid'],
        isActive: false,
      });

      cacheProvider.get.mockResolvedValueOnce(null);
      clientRepository.findByClientId.mockResolvedValueOnce(deactivatedClient);

      const result = await handler.execute({
        clientId: 'legacy-portal-app',
        origin: 'https://legacy.angelsolutions.io',
      });

      expect(result).toEqual({
        authorized: false,
        clientId: 'legacy-portal-app',
        clientType: 'public',
        errorCode: 'client_deactivated',
        message: 'Client application "legacy-portal-app" is currently deactivated.',
      });
    });

    it('should return errorCode "client_not_found" and not populate cache when client does not exist', async () => {
      cacheProvider.get.mockResolvedValueOnce(null);
      clientRepository.findByClientId.mockResolvedValueOnce(null);

      const result = await handler.execute({
        clientId: 'unknown-client-id',
        origin: 'https://portfolio.angelsolutions.io',
      });

      expect(cacheProvider.set).not.toHaveBeenCalled();
      expect(result).toEqual({
        authorized: false,
        clientId: 'unknown-client-id',
        errorCode: 'client_not_found',
        message: 'Client application "unknown-client-id" was not found in registered_clients.',
      });
    });

    it('should return errorCode "missing_client_id" when clientId is empty or omitted', async () => {
      const result = await handler.execute({ clientId: '   ' });

      expect(cacheProvider.get).not.toHaveBeenCalled();
      expect(result.authorized).toBe(false);
      expect(result.errorCode).toBe('missing_client_id');
    });

    it('should return errorCode "invalid_client_id" when clientId violates format rules', async () => {
      const result = await handler.execute({ clientId: 'invalid client id!' });

      expect(cacheProvider.get).not.toHaveBeenCalled();
      expect(result.authorized).toBe(false);
      expect(result.errorCode).toBe('invalid_client_id');
    });
  });
});