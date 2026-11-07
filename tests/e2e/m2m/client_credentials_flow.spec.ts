// Pending client contract to be closed in Fase 2 (Clausura Bottom-Up)
import { OAuth2M2MClient } from '../../../interfaces/http/client/oauth2_m2m_client';

describe('M2M E2E Spec: OAuth2 Client Credentials & Scoped Grant', () => {
  it('should authenticate confidential client and receive signed Bearer token with granted scopes', async () => {
    const mockHttpTransport = {
      post: jest.fn().mockResolvedValue({
        status: 200,
        data: {
          access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJvcmRlci1zZXJ2aWNlIiwic2NvcGUiOiJpZGVudGl0eTpyZWFkIn0.mockSignature',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'identity:read',
        },
      }),
    };

    const client = new OAuth2M2MClient({
      baseUrl: 'http://localhost:3000',
      transport: mockHttpTransport,
    });

    const response = await client.requestToken({
      grantType: 'client_credentials',
      clientId: 'order-service',
      clientSecret: 'ValidSecret123!_SuperSecureSecretForTesting_2026',
      scope: 'identity:read',
    });

    expect(response.access_token).toBeDefined();
    expect(response.token_type).toBe('Bearer');
    expect(response.expires_in).toBe(3600);
    expect(response.scope).toBe('identity:read');
    expect(mockHttpTransport.post).toHaveBeenCalledWith(
      '/api/v1/oauth2/token',
      expect.objectContaining({
        grant_type: 'client_credentials',
        client_id: 'order-service',
        client_secret: 'ValidSecret123!_SuperSecureSecretForTesting_2026',
        scope: 'identity:read',
      }),
      expect.any(Object)
    );
  });

  it('should reject client credentials request from public client with unauthorized_client', async () => {
    const mockHttpTransport = {
      post: jest.fn().mockRejectedValue({
        status: 400,
        error: 'unauthorized_client',
        error_description: 'Public clients are not authorized to use client_credentials grant type',
      }),
    };

    const client = new OAuth2M2MClient({
      baseUrl: 'http://localhost:3000',
      transport: mockHttpTransport,
    });

    await expect(
      client.requestToken({
        grantType: 'client_credentials',
        clientId: 'portal-web',
        clientSecret: '',
      })
    ).rejects.toEqual(
      expect.objectContaining({
        status: 400,
        error: 'unauthorized_client',
      })
    );
  });

  it('should reject request when client requests scopes not granted to it with invalid_scope', async () => {
    const mockHttpTransport = {
      post: jest.fn().mockRejectedValue({
        status: 400,
        error: 'invalid_scope',
        error_description: 'Requested scope "identity:admin" is not authorized for client "analytics-worker"',
      }),
    };

    const client = new OAuth2M2MClient({
      baseUrl: 'http://localhost:3000',
      transport: mockHttpTransport,
    });

    await expect(
      client.requestToken({
        grantType: 'client_credentials',
        clientId: 'analytics-worker',
        clientSecret: 'WorkerSecret123!_SuperSecureSecretForTesting_2026',
        scope: 'identity:admin',
      })
    ).rejects.toEqual(
      expect.objectContaining({
        status: 400,
        error: 'invalid_scope',
      })
    );
  });

  it('should reject request when client secret is invalid with invalid_client', async () => {
    const mockHttpTransport = {
      post: jest.fn().mockRejectedValue({
        status: 401,
        error: 'invalid_client',
        error_description: 'Client authentication failed: invalid client credentials',
      }),
    };

    const client = new OAuth2M2MClient({
      baseUrl: 'http://localhost:3000',
      transport: mockHttpTransport,
    });

    await expect(
      client.requestToken({
        grantType: 'client_credentials',
        clientId: 'order-service',
        clientSecret: 'WrongSecret123!_SuperSecureSecretForTesting_2026',
        scope: 'identity:read',
      })
    ).rejects.toEqual(
      expect.objectContaining({
        status: 401,
        error: 'invalid_client',
      })
    );
  });

  describe('In-Memory Smart Caching & Preemptive Auto-Renewal (getValidToken)', () => {
    it('should reuse cached token on subsequent calls (Cache Hit) without HTTP request', async () => {
      const mockHttpTransport = {
        post: jest.fn().mockResolvedValue({
          status: 200,
          data: {
            access_token: 'cached-jwt-token-sample',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'identity:read',
          },
        }),
      };

      const client = new OAuth2M2MClient({
        baseUrl: 'http://localhost:3000',
        transport: mockHttpTransport,
        refreshBufferSeconds: 60,
      });

      const params = {
        grantType: 'client_credentials',
        clientId: 'order-service',
        clientSecret: 'ValidSecret123!_SuperSecureSecretForTesting_2026',
        scope: 'identity:read',
      };

      // 1. Primer llamado -> llamada HTTP real
      const token1 = await client.getValidToken(params);
      expect(token1.access_token).toBe('cached-jwt-token-sample');
      expect(mockHttpTransport.post).toHaveBeenCalledTimes(1);

      // 2. Segundo llamado -> Cache Hit en memoria, cero peticiones HTTP
      const token2 = await client.getValidToken(params);
      expect(token2.access_token).toBe('cached-jwt-token-sample');
      expect(mockHttpTransport.post).toHaveBeenCalledTimes(1);
    });

    it('should automatically renew token if remaining TTL is within refresh buffer window (60s)', async () => {
      const mockHttpTransport = {
        post: jest
          .fn()
          .mockResolvedValueOnce({
            status: 200,
            data: {
              access_token: 'expiring-token',
              token_type: 'Bearer',
              expires_in: 50, // Menor que el buffer de 60s
              scope: 'identity:read',
            },
          })
          .mockResolvedValueOnce({
            status: 200,
            data: {
              access_token: 'renewed-token',
              token_type: 'Bearer',
              expires_in: 3600,
              scope: 'identity:read',
            },
          }),
      };

      const client = new OAuth2M2MClient({
        baseUrl: 'http://localhost:3000',
        transport: mockHttpTransport,
        refreshBufferSeconds: 60,
      });

      const params = {
        grantType: 'client_credentials',
        clientId: 'order-service',
        clientSecret: 'ValidSecret123!_SuperSecureSecretForTesting_2026',
        scope: 'identity:read',
      };

      // Primer llamado guarda token que expira en 50s (dentro del buffer de 60s)
      const token1 = await client.getValidToken(params);
      expect(token1.access_token).toBe('expiring-token');
      expect(mockHttpTransport.post).toHaveBeenCalledTimes(1);

      // Segundo llamado detecta expiración inminente y renueva preventivamente
      const token2 = await client.getValidToken(params);
      expect(token2.access_token).toBe('renewed-token');
      expect(mockHttpTransport.post).toHaveBeenCalledTimes(2);
    });

    it('should bypass cache and force fresh renewal when requestToken() is called explicitly', async () => {
      const mockHttpTransport = {
        post: jest
          .fn()
          .mockResolvedValueOnce({
            status: 200,
            data: {
              access_token: 'first-token',
              token_type: 'Bearer',
              expires_in: 3600,
            },
          })
          .mockResolvedValueOnce({
            status: 200,
            data: {
              access_token: 'forced-fresh-token',
              token_type: 'Bearer',
              expires_in: 3600,
            },
          }),
      };

      const client = new OAuth2M2MClient({
        transport: mockHttpTransport,
      });

      const params = {
        clientId: 'order-service',
        clientSecret: 'ValidSecret123!_SuperSecureSecretForTesting_2026',
      };

      await client.getValidToken(params);
      expect(mockHttpTransport.post).toHaveBeenCalledTimes(1);

      // requestToken fuerza refresco
      const freshToken = await client.requestToken(params);
      expect(freshToken.access_token).toBe('forced-fresh-token');
      expect(mockHttpTransport.post).toHaveBeenCalledTimes(2);
    });

    it('should allow clearing and invalidating cache selectively', async () => {
      const mockHttpTransport = {
        post: jest.fn().mockResolvedValue({
          status: 200,
          data: {
            access_token: 'token-sample',
            token_type: 'Bearer',
            expires_in: 3600,
          },
        }),
      };

      const client = new OAuth2M2MClient({ transport: mockHttpTransport });
      const params = {
        clientId: 'order-service',
        clientSecret: 'ValidSecret123!_SuperSecureSecretForTesting_2026',
      };

      await client.getValidToken(params);
      expect(mockHttpTransport.post).toHaveBeenCalledTimes(1);

      client.invalidateToken(params);

      await client.getValidToken(params);
      expect(mockHttpTransport.post).toHaveBeenCalledTimes(2);

      client.clearTokenCache();
      await client.getValidToken(params);
      expect(mockHttpTransport.post).toHaveBeenCalledTimes(3);
    });
  });
});

