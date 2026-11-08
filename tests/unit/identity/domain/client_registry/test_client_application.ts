import { ClientApplication } from '../../../../../src/contexts/identity/domain/entities/client_application/aggregate';
import { ClientId } from '../../../../../src/contexts/identity/domain/value_objects/client_id/value';
import { ClientSecret } from '../../../../../src/contexts/identity/domain/value_objects/client_secret/value';
import { OriginDomain } from '../../../../../src/contexts/identity/domain/value_objects/origin_domain/value';
import { DomainValidationError } from '../../../../../src/contexts/identity/domain/exceptions/user/error';
import { OAuth2AuthenticationError } from '../../../../../src/contexts/identity/domain/exceptions/oauth2/error';

describe('Aggregate Root: ClientApplication', () => {
  const validClientId = ClientId.create('portal-web');
  const validOrigin = OriginDomain.create('https://portal.angelpixel.io');

  describe('Creation of Public Client Application', () => {
    it('should successfully create a public client without clientSecretHash', () => {
      const client = ClientApplication.create({
        id: 'client-1',
        clientId: validClientId,
        clientName: 'AngelPixel Web Portal',
        clientType: 'public',
        allowedOrigins: [validOrigin],
        redirectUris: ['https://portal.angelpixel.io/callback'],
        allowedGrantTypes: ['authorization_code'],
        scopes: ['openid', 'profile'],
        isActive: true,
      });

      expect(client.getId()).toBe('client-1');
      expect(client.getClientId().getValue()).toBe('portal-web');
      expect(client.getClientType()).toBe('public');
      expect(client.getClientSecretHash()).toBeNull();
      expect(client.isActive()).toBe(true);
      expect(client.getAllowedOrigins()).toHaveLength(1);
    });

    it('should throw DomainValidationError if public client provides a clientSecretHash', () => {
      expect(() =>
        ClientApplication.create({
          id: 'client-1',
          clientId: validClientId,
          clientName: 'Public SPA with secret',
          clientType: 'public',
          clientSecretHash: 'forbidden-secret-hash',
          allowedOrigins: [validOrigin],
          redirectUris: ['https://portal.angelpixel.io/callback'],
          allowedGrantTypes: ['authorization_code'],
          scopes: ['openid'],
          isActive: true,
        })
      ).toThrow(DomainValidationError);
    });
  });

  describe('Creation of Confidential Client Application', () => {
    it('should successfully create a confidential client with clientSecretHash', () => {
      const client = ClientApplication.create({
        id: 'client-2',
        clientId: ClientId.create('backend-m2m'),
        clientName: 'Order Processing Service',
        clientType: 'confidential',
        clientSecretHash: '$2b$10$hashedsecretvalue12345678901234567890',
        allowedOrigins: [OriginDomain.create('https://api.angelpixel.io')],
        redirectUris: ['https://api.angelpixel.io/oauth2/callback'],
        allowedGrantTypes: ['client_credentials'],
        scopes: ['orders:read', 'orders:write'],
        isActive: true,
      });

      expect(client.getClientType()).toBe('confidential');
      expect(client.getClientSecretHash()).toBe('$2b$10$hashedsecretvalue12345678901234567890');
    });

    it('should throw DomainValidationError if confidential client is missing clientSecretHash', () => {
      expect(() =>
        ClientApplication.create({
          id: 'client-2',
          clientId: ClientId.create('backend-m2m'),
          clientName: 'Order Processing Service',
          clientType: 'confidential',
          allowedOrigins: [validOrigin],
          redirectUris: ['https://api.angelpixel.io/callback'],
          allowedGrantTypes: ['client_credentials'],
          scopes: ['orders:read'],
          isActive: true,
        })
      ).toThrow(DomainValidationError);
    });
  });

  describe('Business Invariants and Methods', () => {
    it('should throw DomainValidationError if allowedOrigins is empty for a public client', () => {
      expect(() =>
        ClientApplication.create({
          id: 'client-3',
          clientId: validClientId,
          clientName: 'Web Portal with no origins',
          clientType: 'public',
          allowedOrigins: [],
          redirectUris: ['https://portal.angelpixel.io/callback'],
          allowedGrantTypes: ['authorization_code'],
          scopes: ['openid'],
          isActive: true,
        })
      ).toThrow(DomainValidationError);
    });

    it('should correctly check if an origin is allowed with isOriginAllowed()', () => {
      const client = ClientApplication.create({
        id: 'client-1',
        clientId: validClientId,
        clientName: 'AngelPixel Web Portal',
        clientType: 'public',
        allowedOrigins: [
          validOrigin,
          OriginDomain.create('https://beta.angelpixel.io'),
        ],
        redirectUris: ['https://portal.angelpixel.io/callback'],
        allowedGrantTypes: ['authorization_code'],
        scopes: ['openid'],
        isActive: true,
      });

      expect(client.isOriginAllowed('https://portal.angelpixel.io')).toBe(true);
      expect(client.isOriginAllowed('https://beta.angelpixel.io/')).toBe(true);
      expect(client.isOriginAllowed('https://malicious-site.com')).toBe(false);
    });

    it('should allow activating and deactivating client application', () => {
      const client = ClientApplication.create({
        id: 'client-1',
        clientId: validClientId,
        clientName: 'AngelPixel Web Portal',
        clientType: 'public',
        allowedOrigins: [validOrigin],
        redirectUris: ['https://portal.angelpixel.io/callback'],
        allowedGrantTypes: ['authorization_code'],
        scopes: ['openid'],
        isActive: true,
      });

      expect(client.isActive()).toBe(true);
      client.deactivate();
      expect(client.isActive()).toBe(false);
      client.activate();
      expect(client.isActive()).toBe(true);
    });
  });

  describe('M2M Grant Invariants and Scope Authorization', () => {
    const validSecret = ClientSecret.create('SuperSecureSecretKeyForTestingClientCredentials_2026!');
    const dummyVerifier = {
      compare: jest.fn(),
    };

    const createConfidentialClient = (overrides?: Partial<Parameters<typeof ClientApplication.create>[0]>) => {
      return ClientApplication.create({
        id: 'client-m2m-test',
        clientId: ClientId.create('backend-worker'),
        clientSecretHash: '$2b$10$hashedsecretvalue12345678901234567890',
        clientName: 'Backend Worker M2M',
        clientType: 'confidential',
        allowedOrigins: [validOrigin],
        redirectUris: [],
        allowedGrantTypes: ['client_credentials'],
        scopes: ['identity:read', 'orders:write'],
        isActive: true,
        ...overrides,
      });
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should validate client credentials grant successfully when active, confidential and secret matches', async () => {
      const client = createConfidentialClient();
      dummyVerifier.compare.mockResolvedValueOnce(true);

      await expect(client.validateClientCredentialsGrant(validSecret, dummyVerifier)).resolves.toBeUndefined();
      expect(dummyVerifier.compare).toHaveBeenCalledWith(
        validSecret.getValue(),
        '$2b$10$hashedsecretvalue12345678901234567890'
      );
    });

    it('should throw OAuth2AuthenticationError (invalid_client, 401) if client is deactivated', async () => {
      const client = createConfidentialClient({ isActive: false });

      await expect(client.validateClientCredentialsGrant(validSecret, dummyVerifier)).rejects.toThrow(
        OAuth2AuthenticationError
      );
      await expect(client.validateClientCredentialsGrant(validSecret, dummyVerifier)).rejects.toMatchObject({
        errorCode: 'invalid_client',
        statusCode: 401,
      });
    });

    it('should throw OAuth2AuthenticationError (unauthorized_client, 400) if client is public', async () => {
      const publicClient = ClientApplication.create({
        id: 'public-client',
        clientId: ClientId.create('portal-web'),
        clientName: 'Public Web App',
        clientType: 'public',
        allowedOrigins: [validOrigin],
        redirectUris: ['https://portal.angelpixel.io/callback'],
        allowedGrantTypes: ['authorization_code'],
        scopes: ['openid'],
        isActive: true,
      });

      await expect(publicClient.validateClientCredentialsGrant(validSecret, dummyVerifier)).rejects.toMatchObject({
        errorCode: 'unauthorized_client',
        statusCode: 400,
      });
    });

    it('should throw OAuth2AuthenticationError (unauthorized_client, 400) if client lacks client_credentials grant type', async () => {
      const client = createConfidentialClient({
        allowedGrantTypes: ['authorization_code'],
      });

      await expect(client.validateClientCredentialsGrant(validSecret, dummyVerifier)).rejects.toMatchObject({
        errorCode: 'unauthorized_client',
        statusCode: 400,
      });
    });

    it('should throw OAuth2AuthenticationError (invalid_client, 401) if secret verifier returns false', async () => {
      const client = createConfidentialClient();
      dummyVerifier.compare.mockResolvedValueOnce(false);

      await expect(client.validateClientCredentialsGrant(validSecret, dummyVerifier)).rejects.toMatchObject({
        errorCode: 'invalid_client',
        statusCode: 401,
      });
    });

    it('should authorize and return all registered scopes when requestedScopes is omitted or empty', () => {
      const client = createConfidentialClient();

      const resultEmpty = client.filterAuthorizedScopes([]);
      expect(resultEmpty.authorized).toBe(true);
      expect(resultEmpty.grantedScopes).toEqual(['identity:read', 'orders:write']);

      const resultUndefined = client.filterAuthorizedScopes(undefined);
      expect(resultUndefined.authorized).toBe(true);
      expect(resultUndefined.grantedScopes).toEqual(['identity:read', 'orders:write']);
    });

    it('should authorize a subset of valid scopes', () => {
      const client = createConfidentialClient();

      const result = client.filterAuthorizedScopes(['identity:read']);
      expect(result.authorized).toBe(true);
      expect(result.grantedScopes).toEqual(['identity:read']);
    });

    it('should reject scopes that are not registered for the client', () => {
      const client = createConfidentialClient();

      const result = client.filterAuthorizedScopes(['identity:read', 'admin:superpower']);
      expect(result.authorized).toBe(false);
      expect(result.unauthorizedScope).toBe('admin:superpower');
    });
  });
});