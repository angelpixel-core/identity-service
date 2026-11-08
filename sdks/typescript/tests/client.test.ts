import { IdentityServiceClient, OAuth2M2MClient } from '../src/client';
import { HttpTransport } from '../src/types/common';

describe('SDK Client: IdentityServiceClient & Domain Resources', () => {
  let mockTransport: HttpTransport;
  let getMock: jest.Mock;
  let postMock: jest.Mock;

  beforeEach(() => {
    getMock = jest.fn();
    postMock = jest.fn();
    mockTransport = {
      get: getMock,
      post: postMock,
    };
  });

  describe('Initialization and Configuration', () => {
    it('should initialize with default configuration when no options provided', () => {
      const client = new IdentityServiceClient();
      expect(client.auth).toBeDefined();
      expect(client.users).toBeDefined();
      expect(client.oauth2).toBeDefined();
      expect(client.tokenManager).toBeDefined();
    });

    it('should instantiate OAuth2M2MClient alias identically', () => {
      const legacyClient = new OAuth2M2MClient({ transport: mockTransport });
      expect(legacyClient).toBeInstanceOf(IdentityServiceClient);
      expect(legacyClient.oauth2).toBeDefined();
    });
  });

  describe('Auth Resource: auth.register', () => {
    it('should call POST /api/v1/auth/register with x-tenant-id header', async () => {
      postMock.mockResolvedValueOnce({
        status: 201,
        data: {
          token: 'jwt-auth-token',
          user: {
            id: 'user-1',
            email: 'admin@alpha.com',
            tenantId: 'alpha-corp',
            roles: ['admin'],
          },
        },
      });

      const client = new IdentityServiceClient({ transport: mockTransport });
      const result = await client.auth.register({
        tenantId: 'alpha-corp',
        email: 'admin@alpha.com',
        password: 'Password123!',
        name: 'Admin Alpha',
      });

      expect(result.token).toBe('jwt-auth-token');
      expect(result.user.email).toBe('admin@alpha.com');
      expect(postMock).toHaveBeenCalledWith(
        '/api/v1/auth/register',
        {
          email: 'admin@alpha.com',
          password: 'Password123!',
          name: 'Admin Alpha',
          roles: undefined,
        },
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-tenant-id': 'alpha-corp',
          }),
        })
      );
    });
  });

  describe('Users Resource: users.getProfile', () => {
    it('should call GET /api/v1/auth/me with Bearer token and x-tenant-id header', async () => {
      getMock.mockResolvedValueOnce({
        status: 200,
        data: {
          id: 'user-1',
          email: 'admin@alpha.com',
          tenantId: 'alpha-corp',
          roles: ['admin'],
        },
      });

      const client = new IdentityServiceClient({ transport: mockTransport });
      const profile = await client.users.getProfile({
        token: 'valid-jwt-token',
        tenantId: 'alpha-corp',
      });

      expect(profile.id).toBe('user-1');
      expect(profile.email).toBe('admin@alpha.com');
      expect(getMock).toHaveBeenCalledWith(
        '/api/v1/auth/me',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer valid-jwt-token',
            'x-tenant-id': 'alpha-corp',
          }),
        })
      );
    });

    it('should throw error if transport does not implement GET', async () => {
      const client = new IdentityServiceClient({
        transport: { post: postMock },
      });

      await expect(
        client.users.getProfile({
          token: 'token',
          tenantId: 'alpha-corp',
        })
      ).rejects.toThrow('El transporte HTTP actual no implementa el método GET');
    });

    it('should call GET /api/v1/users/:userId with Bearer token and x-tenant-id header', async () => {
      getMock.mockResolvedValueOnce({
        status: 200,
        data: {
          id: 'user-999',
          email: 'exec@alpha.com',
          tenantId: 'alpha-corp',
          roles: ['user'],
        },
      });

      const client = new IdentityServiceClient({ transport: mockTransport });
      const profile = await client.users.getUserById({
        userId: 'user-999',
        token: 'valid-jwt-token',
        tenantId: 'alpha-corp',
      });

      expect(profile.id).toBe('user-999');
      expect(getMock).toHaveBeenCalledWith(
        '/api/v1/users/user-999',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer valid-jwt-token',
            'x-tenant-id': 'alpha-corp',
          }),
        })
      );
    });
  });

  describe('OAuth2 Resource: oauth2.validateOrigin', () => {
    it('should call POST /api/v1/oauth2/clients/validate with Origin header', async () => {
      postMock.mockResolvedValueOnce({
        status: 200,
        data: {
          authorized: true,
          clientId: 'portal-web',
          clientName: 'AngelPixel Web Portal',
          clientType: 'public',
          allowedOrigins: ['https://portal.angelpixel.io'],
          scopes: ['openid', 'profile'],
        },
      });

      const client = new IdentityServiceClient({ transport: mockTransport });
      const result = await client.oauth2.validateOrigin({
        clientId: 'portal-web',
        origin: 'https://portal.angelpixel.io',
      });

      expect(result.authorized).toBe(true);
      expect(result.clientId).toBe('portal-web');
      expect(postMock).toHaveBeenCalledWith(
        '/api/v1/oauth2/clients/validate',
        { clientId: 'portal-web' },
        expect.objectContaining({
          headers: expect.objectContaining({
            Origin: 'https://portal.angelpixel.io',
          }),
        })
      );
    });
  });

  describe('Direct Convenience Methods for Backward Compatibility', () => {
    it('should delegate getValidToken and requestToken directly to oauth2 resource', async () => {
      postMock.mockResolvedValue({
        status: 200,
        data: {
          access_token: 'direct-token',
          token_type: 'Bearer',
          expires_in: 3600,
        },
      });

      const client = new IdentityServiceClient({ transport: mockTransport });
      const params = {
        clientId: 'm2m-service-app',
        clientSecret: 'ValidSecret123!_SuperSecureSecretForTesting_2026',
      };

      const token1 = await client.getValidToken(params);
      expect(token1.access_token).toBe('direct-token');

      client.invalidateToken(params);
      client.clearTokenCache();

      const token2 = await client.requestToken(params);
      expect(token2.access_token).toBe('direct-token');
    });
  });
});

