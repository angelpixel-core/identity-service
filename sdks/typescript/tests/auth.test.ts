import { TokenManager } from '../src/auth';
import { HttpTransport } from '../src/types/common';

describe('SDK Auth: TokenManager (Smart In-Memory Caching & Preemptive Renewal)', () => {
  let mockTransport: HttpTransport;
  let postMock: jest.Mock;

  beforeEach(() => {
    postMock = jest.fn();
    mockTransport = {
      post: postMock,
    };
  });

  const sampleParams = {
    grantType: 'client_credentials',
    clientId: 'm2m-service-app',
    clientSecret: 'ValidSecret123!_SuperSecureSecretForTesting_2026',
    scope: 'identity:read',
  };

  it('should fetch token via HTTP on first call and store in cache', async () => {
    postMock.mockResolvedValueOnce({
      status: 200,
      data: {
        access_token: 'first-token-value',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'identity:read',
      },
    });

    const manager = new TokenManager({
      transport: mockTransport,
      refreshBufferSeconds: 60,
    });

    const token = await manager.getValidToken(sampleParams);

    expect(token.access_token).toBe('first-token-value');
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith(
      '/api/v1/oauth2/token',
      {
        grant_type: 'client_credentials',
        client_id: 'm2m-service-app',
        client_secret: 'ValidSecret123!_SuperSecureSecretForTesting_2026',
        scope: 'identity:read',
      },
      expect.any(Object)
    );
  });

  it('should return cached token on consecutive calls (Cache Hit) without HTTP request', async () => {
    postMock.mockResolvedValueOnce({
      status: 200,
      data: {
        access_token: 'cached-token-value',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'identity:read',
      },
    });

    const manager = new TokenManager({
      transport: mockTransport,
      refreshBufferSeconds: 60,
    });

    const token1 = await manager.getValidToken(sampleParams);
    const token2 = await manager.getValidToken(sampleParams);

    expect(token1.access_token).toBe('cached-token-value');
    expect(token2.access_token).toBe('cached-token-value');
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('should renew token proactively when remaining TTL is within refresh buffer window', async () => {
    postMock
      .mockResolvedValueOnce({
        status: 200,
        data: {
          access_token: 'expiring-token',
          token_type: 'Bearer',
          expires_in: 45, // Menor a refreshBufferSeconds (60)
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
      });

    const manager = new TokenManager({
      transport: mockTransport,
      refreshBufferSeconds: 60,
    });

    const token1 = await manager.getValidToken(sampleParams);
    expect(token1.access_token).toBe('expiring-token');
    expect(postMock).toHaveBeenCalledTimes(1);

    // Segundo llamado detecta TTL crítico (45s <= 60s) y renueva inmediatamente
    const token2 = await manager.getValidToken(sampleParams);
    expect(token2.access_token).toBe('renewed-token');
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  it('should force fresh token request bypassing cache when requestToken() is called', async () => {
    postMock
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
      });

    const manager = new TokenManager({ transport: mockTransport });

    await manager.getValidToken(sampleParams);
    expect(postMock).toHaveBeenCalledTimes(1);

    const fresh = await manager.requestToken(sampleParams);
    expect(fresh.access_token).toBe('forced-fresh-token');
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  it('should invalidate cache selectively for a specific client and scope', async () => {
    postMock.mockResolvedValue({
      status: 200,
      data: {
        access_token: 'token-val',
        token_type: 'Bearer',
        expires_in: 3600,
      },
    });

    const manager = new TokenManager({ transport: mockTransport });

    await manager.getValidToken(sampleParams);
    expect(postMock).toHaveBeenCalledTimes(1);

    manager.invalidateToken(sampleParams);

    await manager.getValidToken(sampleParams);
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  it('should clear all cache entries when clearTokenCache() is invoked', async () => {
    postMock.mockResolvedValue({
      status: 200,
      data: {
        access_token: 'token-val',
        token_type: 'Bearer',
        expires_in: 3600,
      },
    });

    const manager = new TokenManager({ transport: mockTransport });

    await manager.getValidToken(sampleParams);
    expect(postMock).toHaveBeenCalledTimes(1);

    manager.clearTokenCache();

    await manager.getValidToken(sampleParams);
    expect(postMock).toHaveBeenCalledTimes(2);
  });
});

