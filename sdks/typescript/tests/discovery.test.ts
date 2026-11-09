import { IdentityServiceClient } from '../src/client';
import { HttpTransport } from '../src/types/common';
import { OpenIdConfiguration, JwksResponse } from '../src/types/discovery';

describe('SDK Resource: DiscoveryResource (OIDC Discovery & JWKS)', () => {
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

  it('should fetch OpenID Configuration metadata from /.well-known/openid-configuration', async () => {
    const mockConfig: OpenIdConfiguration = {
      issuer: 'https://id.angelpixel.io',
      authorization_endpoint: 'https://id.angelpixel.io/oauth2/authorize',
      token_endpoint: 'https://id.angelpixel.io/api/v1/oauth2/token',
      jwks_uri: 'https://id.angelpixel.io/.well-known/jwks.json',
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
    };

    getMock.mockResolvedValueOnce({
      status: 200,
      data: mockConfig,
    });

    const client = new IdentityServiceClient({ transport: mockTransport });
    const result = await client.discovery.getOpenIdConfiguration();

    expect(getMock).toHaveBeenCalledWith('/.well-known/openid-configuration', undefined);
    expect(result.issuer).toBe('https://id.angelpixel.io');
    expect(result.jwks_uri).toBe('https://id.angelpixel.io/.well-known/jwks.json');
    expect(result.id_token_signing_alg_values_supported).toContain('RS256');
  });

  it('should fetch JWKS public key set from /.well-known/jwks.json', async () => {
    const mockJwks: JwksResponse = {
      keys: [
        {
          kty: 'RSA',
          use: 'sig',
          alg: 'RS256',
          kid: 'key-2026-prod',
          n: 'mock-modulus',
          e: 'AQAB',
        },
      ],
    };

    getMock.mockResolvedValueOnce({
      status: 200,
      data: mockJwks,
    });

    const client = new IdentityServiceClient({ transport: mockTransport });
    const result = await client.discovery.getJwks();

    expect(getMock).toHaveBeenCalledWith('/.well-known/jwks.json', undefined);
    expect(result.keys.length).toBe(1);
    expect(result.keys[0]?.kid).toBe('key-2026-prod');
    expect(result.keys[0]?.kty).toBe('RSA');
  });

  it('should pass custom request options to transport', async () => {
    getMock.mockResolvedValueOnce({
      status: 200,
      data: { keys: [] },
    });

    const client = new IdentityServiceClient({ transport: mockTransport });
    const customOptions = { timeoutMs: 5000, headers: { 'X-Custom-Trace': 'trace-1' } };
    await client.discovery.getJwks(customOptions);

    expect(getMock).toHaveBeenCalledWith('/.well-known/jwks.json', customOptions);
  });
});
