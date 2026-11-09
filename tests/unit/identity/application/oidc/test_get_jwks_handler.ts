import { GetJwksQueryHandler } from '../../../../../src/contexts/identity/application/queries/get_jwks/handler';
import { AsymmetricKeyProviderPort } from '../../../../../src/contexts/identity/domain/ports/crypto/asymmetric_key_provider_port';

describe('Application Query Handler: GetJwksQueryHandler', () => {
  it('should throw an error if asymmetricKeyProvider is not provided to constructor', () => {
    expect(() => new GetJwksQueryHandler(null as any)).toThrow();
  });

  it('should delegate to asymmetricKeyProvider.getPublicKeyJwks() and return keys', () => {
    const mockJwks = {
      keys: [
        {
          kty: 'RSA' as const,
          use: 'sig' as const,
          alg: 'RS256' as const,
          kid: 'mock-key-1',
          n: 'mock-n',
          e: 'AQAB',
        },
      ],
    };

    const mockProvider: AsymmetricKeyProviderPort = {
      getActiveKeyId: jest.fn().mockReturnValue('mock-key-1'),
      getPublicKeyJwks: jest.fn().mockReturnValue(mockJwks),
      getPublicKeyPem: jest.fn().mockReturnValue('mock-pem'),
      signToken: jest.fn().mockResolvedValue('token'),
      verifyToken: jest.fn().mockResolvedValue({}),
    };

    const handler = new GetJwksQueryHandler(mockProvider);
    const result = handler.execute();

    expect(mockProvider.getPublicKeyJwks).toHaveBeenCalled();
    expect(result.keys.length).toBe(1);
    expect(result.keys[0]?.kid).toBe('mock-key-1');
  });

  it('should return empty keys array safely if provider returns invalid response', () => {
    const mockProvider: AsymmetricKeyProviderPort = {
      getActiveKeyId: jest.fn().mockReturnValue('mock-key-1'),
      getPublicKeyJwks: jest.fn().mockReturnValue(null as any),
      getPublicKeyPem: jest.fn().mockReturnValue('mock-pem'),
      signToken: jest.fn().mockResolvedValue('token'),
      verifyToken: jest.fn().mockResolvedValue({}),
    };

    const handler = new GetJwksQueryHandler(mockProvider);
    const result = handler.execute();

    expect(result).toHaveProperty('keys');
    expect(result.keys).toEqual([]);
  });
});

