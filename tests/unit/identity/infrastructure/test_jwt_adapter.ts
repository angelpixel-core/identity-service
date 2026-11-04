import {
  AuthTokenClaims,
  TokenProviderPort,
} from '../../../../src/contexts/identity/application/ports/security/token_provider';
// @ts-expect-error - Module will be implemented in the green phase
import { JwtTokenAdapter } from '../../../../src/contexts/identity/infrastructure/security/jwt_adapter';

describe('Infrastructure Adapter: JwtTokenAdapter', () => {
  const secretKey = 'super-secure-jwt-test-secret-key-12345';
  let adapter: TokenProviderPort;

  const validClaims: AuthTokenClaims = {
    userId: 'user-uuid-1234',
    email: 'tenant.admin@acme.com',
    tenantId: 'tenant-acme-corp',
  };

  beforeEach(() => {
    adapter = new JwtTokenAdapter(secretKey, '1h');
  });

  describe('Constructor Validations', () => {
    it('should throw an error when initialized with an empty secret key', () => {
      expect(() => new JwtTokenAdapter('')).toThrow(
        'Secret key must be a non-empty string'
      );
      expect(() => new JwtTokenAdapter('   ')).toThrow(
        'Secret key must be a non-empty string'
      );
    });
  });

  describe('Token Generation (generateToken)', () => {
    it('should generate a valid JWT format containing 3 base64url segments separated by dots', async () => {
      const token = await adapter.generateToken(validClaims);

      expect(typeof token).toBe('string');
      const parts = token.split('.');
      expect(parts.length).toBe(3);
    });

    it('should produce tokens that can be verified and decode original claims', async () => {
      const token = await adapter.generateToken(validClaims);
      const decodedClaims = await adapter.verifyToken(token);

      expect(decodedClaims.userId).toBe(validClaims.userId);
      expect(decodedClaims.email).toBe(validClaims.email);
      expect(decodedClaims.tenantId).toBe(validClaims.tenantId);
    });
  });

  describe('Token Verification (verifyToken)', () => {
    it('should reject when verifying a token signed with a different secret', async () => {
      const foreignAdapter = new JwtTokenAdapter('foreign-unauthorized-secret-key');
      const foreignToken = await foreignAdapter.generateToken(validClaims);

      await expect(adapter.verifyToken(foreignToken)).rejects.toThrow();
    });

    it('should reject when verifying an expired token', async () => {
      const shortLivedAdapter = new JwtTokenAdapter(secretKey, -10); // Expired 10 seconds ago
      const expiredToken = await shortLivedAdapter.generateToken(validClaims);

      await expect(adapter.verifyToken(expiredToken)).rejects.toThrow();
    });

    it('should reject when token is malformed or invalid string', async () => {
      await expect(adapter.verifyToken('invalid.token.structure')).rejects.toThrow();
      await expect(adapter.verifyToken('')).rejects.toThrow();
    });
  });
});

