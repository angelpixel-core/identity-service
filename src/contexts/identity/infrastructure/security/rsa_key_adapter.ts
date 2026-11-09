import crypto from 'crypto';
import util from 'util';
import jwt, { SignOptions, VerifyOptions } from 'jsonwebtoken';
import {
  AsymmetricKeyProviderPort,
  AsymmetricSignOptions,
  JwksResponseDto,
} from '../../domain/ports/crypto/asymmetric_key_provider_port';
import { KeyId } from '../../domain/value_objects/crypto/key_id';
import { JsonWebKeyVO } from '../../domain/value_objects/crypto/json_web_key';

export interface RsaKeyAdapterOptions {
  readonly privateKeyPem?: string;
  readonly publicKeyPem?: string;
  readonly keyId?: string;
  readonly defaultExpiresIn?: string | number;
}

/**
 * Secondary Adapter: RsaKeyAdapter
 * Implementación de AsymmetricKeyProviderPort basada en la API estándar de criptografía
 * de Node.js (node:crypto) y firmado asimétrico RS256 con jsonwebtoken.
 * Endurecida con redacción de claves privadas en logs e inspección, y validación defensiva de PEM.
 */
export class RsaKeyAdapter implements AsymmetricKeyProviderPort {
  private readonly privateKeyPem: string;
  private readonly publicKeyPem: string;
  private readonly keyId: KeyId;
  private readonly defaultExpiresIn: string | number;
  private readonly cachedJwks: JwksResponseDto;

  constructor(options?: RsaKeyAdapterOptions) {
    this.defaultExpiresIn = options?.defaultExpiresIn ?? '1h';

    if (options?.privateKeyPem && options?.publicKeyPem) {
      try {
        crypto.createPrivateKey(options.privateKeyPem);
        crypto.createPublicKey(options.publicKeyPem);
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        throw new Error(`Invalid RSA PEM keypair: ${errorMsg}`);
      }

      this.privateKeyPem = options.privateKeyPem;
      this.publicKeyPem = options.publicKeyPem;
      const rawKid = options.keyId ?? this.computeThumbprint(this.publicKeyPem);
      this.keyId = KeyId.create(rawKid);
    } else {
      // Auto-generación en memoria de par de claves RSA 2048-bit (seguro para desarrollo y tests)
      const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem',
        },
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'pem',
        },
      });

      this.privateKeyPem = privateKey;
      this.publicKeyPem = publicKey;
      const rawKid = options?.keyId ?? this.computeThumbprint(this.publicKeyPem);
      this.keyId = KeyId.create(rawKid);
    }

    // Calcular y validar la representación JWK pública mediante el Value Object de dominio
    const keyObject = crypto.createPublicKey(this.publicKeyPem);
    const jwkData = keyObject.export({ format: 'jwk' });

    if (!jwkData.n || !jwkData.e) {
      throw new Error('Failed to extract modulus (n) and exponent (e) from public key');
    }

    const jwkVo = JsonWebKeyVO.create({
      kty: 'RSA',
      use: 'sig',
      alg: 'RS256',
      kid: this.keyId,
      n: jwkData.n,
      e: jwkData.e,
    });

    this.cachedJwks = Object.freeze({
      keys: Object.freeze([jwkVo.toDto()]),
    });
  }

  public getActiveKeyId(): string {
    return this.keyId.getValue();
  }

  public getPublicKeyJwks(): JwksResponseDto {
    return this.cachedJwks;
  }

  public getPublicKeyPem(_kid?: string): string {
    return this.publicKeyPem;
  }

  public getPrivateKeyPem(): string {
    return this.privateKeyPem;
  }

  public async signToken(
    payload: Record<string, unknown>,
    options?: AsymmetricSignOptions
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const signOpts: SignOptions = {
        algorithm: 'RS256',
        keyid: options?.keyId ?? this.keyId.getValue(),
        expiresIn: (options?.expiresIn ?? this.defaultExpiresIn) as any,
      };

      jwt.sign(payload, this.privateKeyPem, signOpts, (err, token) => {
        if (err || !token) {
          return reject(err ?? new Error('Failed to sign RS256 token'));
        }
        resolve(token);
      });
    });
  }

  public async verifyToken<T = any>(token: string): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!token || typeof token !== 'string' || token.trim().length === 0) {
        return reject(new Error('Token must be a non-empty string'));
      }

      const verifyOpts: VerifyOptions = {
        algorithms: ['RS256'],
      };

      jwt.verify(token, this.publicKeyPem, verifyOpts, (err, decoded) => {
        if (err || !decoded) {
          return reject(err ?? new Error('Token verification failed'));
        }
        resolve(decoded as T);
      });
    });
  }

  public toString(): string {
    return `RsaKeyAdapter(kid=${this.keyId.getValue()}, privateKey=[REDACTED])`;
  }

  public [util.inspect.custom](): Record<string, unknown> {
    return {
      keyId: this.keyId.getValue(),
      privateKey: '[REDACTED]',
      publicKey: this.publicKeyPem,
      defaultExpiresIn: this.defaultExpiresIn,
    };
  }

  private computeThumbprint(publicKeyPem: string): string {
    const cleanKey = publicKeyPem
      .replace(/-----BEGIN [A-Z ]+-----/g, '')
      .replace(/-----END [A-Z ]+-----/g, '')
      .replace(/\s+/g, '');
    const hash = crypto.createHash('sha256').update(cleanKey).digest('hex');
    return `key-${hash.substring(0, 12)}`;
  }
}
