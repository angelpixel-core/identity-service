import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { RsaKeyAdapter } from '../../../../../src/contexts/identity/infrastructure/security/rsa_key_adapter';

describe('Unit: RsaKeyAdapter (Cryptographic Keypair & RS256 Signing)', () => {
  it('should auto-generate a valid 2048-bit RSA keypair and export JWK format by default', () => {
    const adapter = new RsaKeyAdapter();

    expect(adapter.getActiveKeyId()).toBeDefined();
    expect(adapter.getActiveKeyId().startsWith('key-')).toBe(true);

    const jwks = adapter.getPublicKeyJwks();
    expect(jwks.keys.length).toBe(1);

    const key = jwks.keys[0]!;
    expect(key.kty).toBe('RSA');
    expect(key.use).toBe('sig');
    expect(key.alg).toBe('RS256');
    expect(key.kid).toBe(adapter.getActiveKeyId());
    expect(typeof key.n).toBe('string');
    expect(key.n.length).toBeGreaterThan(50);
    expect(key.e).toBe('AQAB');

    const pem = adapter.getPublicKeyPem();
    expect(pem).toContain('-----BEGIN PUBLIC KEY-----');
    expect(pem).toContain('-----END PUBLIC KEY-----');
  });

  it('should accept custom PEM keypair and keyId from options', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const customKid = 'custom-test-key-2026';
    const adapter = new RsaKeyAdapter({
      privateKeyPem: privateKey,
      publicKeyPem: publicKey,
      keyId: customKid,
    });

    expect(adapter.getActiveKeyId()).toBe(customKid);
    const jwks = adapter.getPublicKeyJwks();
    expect(jwks.keys[0]!.kid).toBe(customKid);
    expect(adapter.getPublicKeyPem()).toBe(publicKey);
    expect(adapter.getPrivateKeyPem()).toBe(privateKey);
  });

  it('should sign a payload using RS256 and include the key ID in JWT header', async () => {
    const adapter = new RsaKeyAdapter();
    const payload = { sub: 'user-unit-test-123', role: 'admin', tenantId: 'tenant-1' };

    const token = await adapter.signToken(payload);
    expect(typeof token).toBe('string');

    const decoded = jwt.decode(token, { complete: true });
    expect(decoded?.header.alg).toBe('RS256');
    expect(decoded?.header.kid).toBe(adapter.getActiveKeyId());
    expect((decoded?.payload as any).sub).toBe('user-unit-test-123');
  });

  it('should successfully verify a valid RS256 token signed by the adapter', async () => {
    const adapter = new RsaKeyAdapter();
    const payload = { sub: 'user-verify-456', scope: 'identity:read' };

    const token = await adapter.signToken(payload, { expiresIn: '10m' });
    const verified = await adapter.verifyToken<{ sub: string; scope: string }>(token);

    expect(verified.sub).toBe('user-verify-456');
    expect(verified.scope).toBe('identity:read');
  });

  it('should reject verification when token is tampered or signed with different key', async () => {
    const adapter1 = new RsaKeyAdapter();
    const adapter2 = new RsaKeyAdapter();

    const tokenFromAdapter2 = await adapter2.signToken({ sub: 'unauthorized-user' });

    // Verifying with adapter1 must fail
    await expect(adapter1.verifyToken(tokenFromAdapter2)).rejects.toThrow();

    // Verifying corrupted token must fail
    await expect(adapter1.verifyToken('not.a.valid.jwt')).rejects.toThrow();
    await expect(adapter1.verifyToken('')).rejects.toThrow('Token must be a non-empty string');
  });
});
