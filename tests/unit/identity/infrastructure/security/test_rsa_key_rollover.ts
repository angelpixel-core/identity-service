import crypto from 'crypto';
import util from 'util';
import jwt from 'jsonwebtoken';
import { RsaKeyAdapter } from '../../../../../src/contexts/identity/infrastructure/security/rsa_key_adapter';

describe('Unit: RsaKeyAdapter Key Rollover (US-16 Zero-Downtime Asymmetric Key Rotation)', () => {
  const generateKeyPair = () => {
    return crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
  };

  it('should update active keyId and sign future tokens with the newly rotated key', async () => {
    const keyPair1 = generateKeyPair();
    const keyPair2 = generateKeyPair();

    const adapter = new RsaKeyAdapter({
      privateKeyPem: keyPair1.privateKey,
      publicKeyPem: keyPair1.publicKey,
      keyId: 'key-v1-2026',
    });

    expect(adapter.getActiveKeyId()).toBe('key-v1-2026');

    // Firmar con key v1
    const tokenV1 = await adapter.signToken({ sub: 'user-1' });
    const decodedV1 = jwt.decode(tokenV1, { complete: true });
    expect(decodedV1?.header.kid).toBe('key-v1-2026');

    // Rota a key v2
    adapter.rotateKeyPair({
      privateKeyPem: keyPair2.privateKey,
      publicKeyPem: keyPair2.publicKey,
      keyId: 'key-v2-2026',
      gracePeriodMs: 60000,
    });

    expect(adapter.getActiveKeyId()).toBe('key-v2-2026');

    // Firmar con key v2
    const tokenV2 = await adapter.signToken({ sub: 'user-2' });
    const decodedV2 = jwt.decode(tokenV2, { complete: true });
    expect(decodedV2?.header.kid).toBe('key-v2-2026');
  });

  it('should expose both active and retained keys in getPublicKeyJwks() during the grace period (RFC 7517)', () => {
    const keyPair1 = generateKeyPair();
    const keyPair2 = generateKeyPair();

    const adapter = new RsaKeyAdapter({
      privateKeyPem: keyPair1.privateKey,
      publicKeyPem: keyPair1.publicKey,
      keyId: 'key-v1-2026',
    });

    let jwks = adapter.getPublicKeyJwks();
    expect(jwks.keys.length).toBe(1);
    expect(jwks.keys[0]?.kid).toBe('key-v1-2026');

    // Rota a key v2 con 60s de grace period
    adapter.rotateKeyPair({
      privateKeyPem: keyPair2.privateKey,
      publicKeyPem: keyPair2.publicKey,
      keyId: 'key-v2-2026',
      gracePeriodMs: 60000,
    });

    jwks = adapter.getPublicKeyJwks();
    expect(jwks.keys.length).toBe(2);

    const keyIds = jwks.keys.map((k) => k.kid);
    expect(keyIds).toContain('key-v2-2026');
    expect(keyIds).toContain('key-v1-2026');

    // Verificar que la primera clave en JWKS sea la activa
    expect(jwks.keys[0]?.kid).toBe('key-v2-2026');
  });

  it('should seamlessly verify tokens signed with the old key and new key during grace period', async () => {
    const keyPair1 = generateKeyPair();
    const keyPair2 = generateKeyPair();

    const adapter = new RsaKeyAdapter({
      privateKeyPem: keyPair1.privateKey,
      publicKeyPem: keyPair1.publicKey,
      keyId: 'key-v1-2026',
    });

    // Token emitido antes de la rotación
    const tokenV1 = await adapter.signToken({ sub: 'user-old-token', role: 'admin' });

    // Rotación en caliente
    adapter.rotateKeyPair({
      privateKeyPem: keyPair2.privateKey,
      publicKeyPem: keyPair2.publicKey,
      keyId: 'key-v2-2026',
      gracePeriodMs: 60000,
    });

    // Token emitido tras la rotación
    const tokenV2 = await adapter.signToken({ sub: 'user-new-token', role: 'user' });

    // Ambos tokens deben verificarse sin fallar
    const verifiedV1 = await adapter.verifyToken<{ sub: string; role: string }>(tokenV1);
    const verifiedV2 = await adapter.verifyToken<{ sub: string; role: string }>(tokenV2);

    expect(verifiedV1.sub).toBe('user-old-token');
    expect(verifiedV1.role).toBe('admin');

    expect(verifiedV2.sub).toBe('user-new-token');
    expect(verifiedV2.role).toBe('user');
  });

  it('should fail-safe: reject invalid PEMs during rotation and keep original keys intact', async () => {
    const keyPair1 = generateKeyPair();

    const adapter = new RsaKeyAdapter({
      privateKeyPem: keyPair1.privateKey,
      publicKeyPem: keyPair1.publicKey,
      keyId: 'key-v1-intact',
    });

    expect(() =>
      adapter.rotateKeyPair({
        privateKeyPem: 'invalid-private-key-data',
        publicKeyPem: keyPair1.publicKey,
        keyId: 'key-invalid',
      })
    ).toThrow(/Invalid candidate RSA PEM keypair for rotation/);

    expect(adapter.getActiveKeyId()).toBe('key-v1-intact');
    expect(adapter.getPublicKeyPem()).toBe(keyPair1.publicKey);

    // Asegurar que sigue funcionando la firma y verificación
    const token = await adapter.signToken({ sub: 'still-working' });
    const verified = await adapter.verifyToken<{ sub: string }>(token);
    expect(verified.sub).toBe('still-working');
  });

  it('should purge retained keys and reject verification when grace period expires', async () => {
    const keyPair1 = generateKeyPair();
    const keyPair2 = generateKeyPair();

    const adapter = new RsaKeyAdapter({
      privateKeyPem: keyPair1.privateKey,
      publicKeyPem: keyPair1.publicKey,
      keyId: 'key-v1-expiring',
    });

    const tokenV1 = await adapter.signToken({ sub: 'user-expired' });

    // Rota con un grace period muy corto (50ms)
    adapter.rotateKeyPair({
      privateKeyPem: keyPair2.privateKey,
      publicKeyPem: keyPair2.publicKey,
      keyId: 'key-v2-active',
      gracePeriodMs: 50,
    });

    // Inmediatamente es verificable
    await expect(adapter.verifyToken(tokenV1)).resolves.toBeDefined();

    // Esperar a que expire la ventana de gracia
    await new Promise((resolve) => setTimeout(resolve, 80));

    // Tras expiración, JWKS ya no contiene la clave vieja
    const jwks = adapter.getPublicKeyJwks();
    expect(jwks.keys.length).toBe(1);
    expect(jwks.keys[0]?.kid).toBe('key-v2-active');

    // Y la verificación de tokens de la clave vieja es rechazada
    await expect(adapter.verifyToken(tokenV1)).rejects.toThrow(/not found or grace period expired/);
  });

  it('should resolve public key PEM by kid or throw if kid not found', () => {
    const keyPair1 = generateKeyPair();
    const keyPair2 = generateKeyPair();

    const adapter = new RsaKeyAdapter({
      privateKeyPem: keyPair1.privateKey,
      publicKeyPem: keyPair1.publicKey,
      keyId: 'key-v1',
    });

    adapter.rotateKeyPair({
      privateKeyPem: keyPair2.privateKey,
      publicKeyPem: keyPair2.publicKey,
      keyId: 'key-v2',
      gracePeriodMs: 60000,
    });

    expect(adapter.getPublicKeyPem()).toBe(keyPair2.publicKey);
    expect(adapter.getPublicKeyPem('key-v2')).toBe(keyPair2.publicKey);
    expect(adapter.getPublicKeyPem('key-v1')).toBe(keyPair1.publicKey);

    expect(() => adapter.getPublicKeyPem('unknown-kid')).toThrow(
      /Public key with kid 'unknown-kid' not found/
    );
  });

  it('should fallback to retained keys when token has no kid header', async () => {
    const keyPair1 = generateKeyPair();
    const keyPair2 = generateKeyPair();

    const adapter = new RsaKeyAdapter({
      privateKeyPem: keyPair1.privateKey,
      publicKeyPem: keyPair1.publicKey,
      keyId: 'key-v1',
    });

    // Crear token manualmente con keyPair1 sin cabecera 'kid'
    const tokenNoKid = jwt.sign({ sub: 'user-no-kid' }, keyPair1.privateKey, {
      algorithm: 'RS256',
    });

    // Rota a keyPair2
    adapter.rotateKeyPair({
      privateKeyPem: keyPair2.privateKey,
      publicKeyPem: keyPair2.publicKey,
      keyId: 'key-v2',
      gracePeriodMs: 60000,
    });

    // Debe resolver verificando con las claves retenidas
    const verified = await adapter.verifyToken<{ sub: string }>(tokenNoKid);
    expect(verified.sub).toBe('user-no-kid');
  });

  it('should reflect retained keys count and keep redaction in toString() and util.inspect()', () => {
    const keyPair1 = generateKeyPair();
    const keyPair2 = generateKeyPair();

    const adapter = new RsaKeyAdapter({
      privateKeyPem: keyPair1.privateKey,
      publicKeyPem: keyPair1.publicKey,
      keyId: 'key-v1',
    });

    adapter.rotateKeyPair({
      privateKeyPem: keyPair2.privateKey,
      publicKeyPem: keyPair2.publicKey,
      keyId: 'key-v2',
      gracePeriodMs: 60000,
    });

    const str = adapter.toString();
    expect(str).toContain('kid=key-v2');
    expect(str).toContain('retainedCount=1');
    expect(str).toContain('privateKey=[REDACTED]');

    const inspected = util.inspect(adapter);
    expect(inspected).toContain('activeKeyId: \'key-v2\'');
    expect(inspected).toContain('retainedKeysCount: 1');
    expect(inspected).toContain('[REDACTED]');
  });
});

