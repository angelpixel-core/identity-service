import crypto from 'crypto';
import { SecretCipherPort } from '../../domain/ports/security/secret_cipher_port';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const VERSION_PREFIX = 'v1';

/**
 * Secondary Adapter: AesGcmSecretCipher (US-33)
 * Cifra y descifra secretos de clientes OIDC/OAuth2 por tenant usando AES-256-GCM.
 */
export class AesGcmSecretCipher implements SecretCipherPort {
  private readonly key: Buffer;

  constructor(masterKey?: string) {
    const resolved =
      masterKey?.trim() ||
      process.env.IDP_SECRET_ENCRYPTION_KEY?.trim() ||
      (process.env.NODE_ENV === 'production'
        ? ''
        : 'dev_only_us33_idp_secret_encryption_key_32!');

    if (!resolved) {
      throw new Error(
        'IDP_SECRET_ENCRYPTION_KEY must be configured in production for AesGcmSecretCipher'
      );
    }

    this.key = crypto.createHash('sha256').update(resolved, 'utf8').digest();
  }

  public encrypt(plaintext: string): string {
    if (!plaintext) {
      throw new Error('Cannot encrypt empty secret plaintext');
    }
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
      VERSION_PREFIX,
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
  }

  public decrypt(ciphertext: string): string {
    const parts = ciphertext.split(':');
    const [version, ivB64, tagB64, encB64] = parts;
    if (parts.length !== 4 || version !== VERSION_PREFIX || !ivB64 || !tagB64 || !encB64) {
      throw new Error('Invalid encrypted secret format');
    }

    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const encrypted = Buffer.from(encB64, 'base64');

    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error('Invalid AES-256-GCM envelope parameters');
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  }
}
