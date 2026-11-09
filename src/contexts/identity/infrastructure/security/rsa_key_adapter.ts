import crypto from 'crypto';
import jwt, { SignOptions, VerifyOptions } from 'jsonwebtoken';
import {
  AsymmetricKeyProviderPort,
  AsymmetricSignOptions,
  JwksResponseDto,
  JsonWebKeyDto,
} from '../../domain/ports/crypto/asymmetric_key_provider_port';

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
 */
export class RsaKeyAdapter implements AsymmetricKeyProviderPort {
  private readonly privateKeyPem: string;
  private readonly publicKeyPem: string;
  private readonly keyId: string;
  private readonly defaultExpiresIn: string | number;
  private readonly cachedJwks: JwksResponseDto;

  constructor(options?: RsaKeyAdapterOptions) {
    this.defaultExpiresIn = options?.defaultExpiresIn ?? '1h';

    if (options?.privateKeyPem && options?.publicKeyPem) {
      this.privateKeyPem = options.privateKeyPem;
      this.publicKeyPem = options.publicKeyPem;
      this.keyId =
        options.keyId ??
        this.computeThumbprint(this.publicKeyPem);
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
      this.keyId = options?.keyId ?? this.computeThumbprint(this.publicKeyPem);
    }

    // Calcular y cachear la representación JWK pública
    const keyObject = crypto.createPublicKey(this.publicKeyPem);
    const jwkData = keyObject.export({ format: 'jwk' });

    if (!jwkData.n || !jwkData.e) {
      throw new Error('Failed to extract modulus (n) and exponent (e) from public key');
    }

    const jwkKey: JsonWebKeyDto = {
      kty: 'RSA',
      use: 'sig',
      alg: 'RS256',
      kid: this.keyId,
      n: jwkData.n,
      e: jwkData.e,
    };

    this.cachedJwks = Object.freeze({
      keys: Object.freeze([Object.freeze(jwkKey)]),
    });
  }

  public getActiveKeyId(): string {
    return this.keyId;
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
        keyid: options?.keyId ?? this.keyId,
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

  private computeThumbprint(publicKeyPem: string): string {
    const cleanKey = publicKeyPem
      .replace(/-----BEGIN [A-Z ]+-----/g, '')
      .replace(/-----END [A-Z ]+-----/g, '')
      .replace(/\s+/g, '');
    const hash = crypto.createHash('sha256').update(cleanKey).digest('hex');
    return `key-${hash.substring(0, 12)}`;
  }
}
