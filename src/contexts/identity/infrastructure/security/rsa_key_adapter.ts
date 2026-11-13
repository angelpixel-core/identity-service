import crypto from 'crypto';
import util from 'util';
import jwt, { SignOptions, VerifyOptions } from 'jsonwebtoken';
import {
  AsymmetricKeyProviderPort,
  AsymmetricSignOptions,
  JwksResponseDto,
  KeyPairRotationOptions,
  JsonWebKeyDto,
} from '../../domain/ports/crypto/asymmetric_key_provider_port';
import { KeyId } from '../../domain/value_objects/crypto/key_id';
import { JsonWebKeyVO } from '../../domain/value_objects/crypto/json_web_key';

export interface RsaKeyAdapterOptions {
  readonly privateKeyPem?: string;
  readonly publicKeyPem?: string;
  readonly keyId?: string;
  readonly defaultExpiresIn?: string | number;
}

interface RetainedKey {
  readonly keyId: KeyId;
  readonly publicKeyPem: string;
  readonly jwkDto: JsonWebKeyDto;
  readonly expiresAt: number;
}

/**
 * Secondary Adapter: RsaKeyAdapter
 * Implementación de AsymmetricKeyProviderPort basada en la API estándar de criptografía
 * de Node.js (node:crypto) y firmado asimétrico RS256 con jsonwebtoken.
 *
 * Características de Resiliencia y Cumplimiento (US-16):
 * 1. Soporte para Key Rollover asimétrico en caliente (Zero-Downtime Key Rotation).
 * 2. Retención de claves públicas previas en JWKS (RFC 7517) durante una ventana de gracia configurable.
 * 3. Verificación transparente multi-clave basada en la cabecera 'kid' del token JWT.
 * 4. Redacción estricta de claves privadas en logs e inspección (util.inspect).
 * 5. Cumplimiento con PCI-DSS v4.0 Req 3.6 y SOC 2 CC6.1.
 */
export class RsaKeyAdapter implements AsymmetricKeyProviderPort {
  private activePrivateKeyPem: string;
  private activePublicKeyPem: string;
  private activeKeyId: KeyId;
  private activeJwkDto: JsonWebKeyDto;
  private readonly defaultExpiresIn: string | number;
  private readonly retainedKeys = new Map<string, RetainedKey>();

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

      this.activePrivateKeyPem = options.privateKeyPem;
      this.activePublicKeyPem = options.publicKeyPem;
      const rawKid = options.keyId ?? this.computeThumbprint(this.activePublicKeyPem);
      this.activeKeyId = KeyId.create(rawKid);
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

      this.activePrivateKeyPem = privateKey;
      this.activePublicKeyPem = publicKey;
      const rawKid = options?.keyId ?? this.computeThumbprint(this.activePublicKeyPem);
      this.activeKeyId = KeyId.create(rawKid);
    }

    this.activeJwkDto = this.buildJwkDto(this.activeKeyId, this.activePublicKeyPem);
  }

  /**
   * Retorna el identificador (`kid`) de la clave asimétrica activa para firmas.
   */
  public getActiveKeyId(): string {
    return this.activeKeyId.getValue();
  }

  /**
   * Exporta el conjunto de claves públicas en formato estándar JWKS (RFC 7517),
   * incluyendo la clave activa y las claves públicas retenidas dentro de la ventana de gracia.
   */
  public getPublicKeyJwks(): JwksResponseDto {
    this.purgeExpiredKeys();
    const keys: JsonWebKeyDto[] = [this.activeJwkDto];

    for (const retained of this.retainedKeys.values()) {
      keys.push(retained.jwkDto);
    }

    return Object.freeze({
      keys: Object.freeze(keys),
    });
  }

  /**
   * Retorna la clave pública en formato PEM estándar (SPKI).
   * Si se especifica un `kid`, resuelve la clave correspondiente (activa o retenida).
   */
  public getPublicKeyPem(kid?: string): string {
    this.purgeExpiredKeys();

    if (!kid || kid === this.activeKeyId.getValue()) {
      return this.activePublicKeyPem;
    }

    const retained = this.retainedKeys.get(kid);
    if (retained) {
      return retained.publicKeyPem;
    }

    throw new Error(`Public key with kid '${kid}' not found in active or retained keys`);
  }

  /**
   * Retorna la clave privada activa en formato PEM.
   */
  public getPrivateKeyPem(): string {
    return this.activePrivateKeyPem;
  }

  /**
   * Rota en caliente el par de claves asimétricas:
   * 1. Valida el nuevo par de claves PEM (Fail-Safe: no modifica el estado si son inválidas).
   * 2. Retiene la clave pública previa en memoria con expiración según `gracePeriodMs` (15 min por defecto).
   * 3. Promueve el nuevo par a activo para firmar nuevos tokens.
   */
  public rotateKeyPair(options: KeyPairRotationOptions): void {
    if (!options.privateKeyPem || !options.publicKeyPem) {
      throw new Error('Both privateKeyPem and publicKeyPem are required for key rotation');
    }

    // 1. Validar sintaxis y coherencia de los PEMs antes de aplicar cambios (Fail-Safe)
    try {
      crypto.createPrivateKey(options.privateKeyPem);
      crypto.createPublicKey(options.publicKeyPem);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid candidate RSA PEM keypair for rotation: ${errorMsg}`);
    }

    const rawKid = options.keyId ?? this.computeThumbprint(options.publicKeyPem);
    const candidateKeyId = KeyId.create(rawKid);

    // Idempotencia defensiva: Si el par de claves candidato es idéntico al activo, evitar re-rotación innecesaria
    if (
      candidateKeyId.getValue() === this.activeKeyId.getValue() &&
      this.activePublicKeyPem.trim() === options.publicKeyPem.trim() &&
      this.activePrivateKeyPem.trim() === options.privateKeyPem.trim()
    ) {
      return;
    }

    const candidateJwkDto = this.buildJwkDto(candidateKeyId, options.publicKeyPem);

    // 2. Retener clave pública previa en memoria durante la ventana de gracia
    const gracePeriodMs = options.gracePeriodMs ?? 15 * 60 * 1000;
    const expiresAt = Date.now() + gracePeriodMs;

    this.retainedKeys.set(this.activeKeyId.getValue(), {
      keyId: this.activeKeyId,
      publicKeyPem: this.activePublicKeyPem,
      jwkDto: this.activeJwkDto,
      expiresAt,
    });

    // Si la clave candidata existía previamente en retenidas, se promueve eliminándose de retenidas
    this.retainedKeys.delete(candidateKeyId.getValue());

    // 3. Promover nuevo par de claves a activo
    this.activePrivateKeyPem = options.privateKeyPem;
    this.activePublicKeyPem = options.publicKeyPem;
    this.activeKeyId = candidateKeyId;
    this.activeJwkDto = candidateJwkDto;

    // 4. Purgar claves expiradas
    this.purgeExpiredKeys();
  }

  /**
   * Retorna la cantidad de claves retenidas vigentes en memoria.
   */
  public getRetainedKeysCount(): number {
    this.purgeExpiredKeys();
    return this.retainedKeys.size;
  }

  /**
   * Firma un payload arbitrario generando un token JWT con algoritmo RS256
   * utilizando la clave privada activa.
   */
  public async signToken(
    payload: Record<string, unknown>,
    options?: AsymmetricSignOptions
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const signOpts: SignOptions = {
        algorithm: 'RS256',
        keyid: options?.keyId ?? this.activeKeyId.getValue(),
        expiresIn: (options?.expiresIn ?? this.defaultExpiresIn) as any,
      };

      jwt.sign(payload, this.activePrivateKeyPem, signOpts, (err, token) => {
        if (err || !token) {
          return reject(err ?? new Error('Failed to sign RS256 token'));
        }
        resolve(token);
      });
    });
  }

  /**
   * Verifica la firma y vigencia de un token RS256.
   * Si el token fue emitido con una clave rotada previa dentro de la ventana de gracia,
   * se valida exitosamente contra la clave pública retenida correspondiente.
   */
  public async verifyToken<T = any>(token: string): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!token || typeof token !== 'string' || token.trim().length === 0) {
        return reject(new Error('Token must be a non-empty string'));
      }

      this.purgeExpiredKeys();

      // Decodificar cabecera para inspeccionar el `kid`
      let kid: string | undefined;
      try {
        const decoded = jwt.decode(token, { complete: true }) as { header?: { kid?: string } } | null;
        kid = decoded?.header?.kid;
      } catch {
        // Formato malformado
      }

      // 1. Intentar validar con la clave activa si coincide el kid o no hay kid
      if (!kid || kid === this.activeKeyId.getValue()) {
        const verifyOpts: VerifyOptions = { algorithms: ['RS256'] };
        jwt.verify(token, this.activePublicKeyPem, verifyOpts, (err, decoded) => {
          if (!err && decoded) {
            return resolve(decoded as T);
          }
          if (kid) {
            return reject(err ?? new Error('Token verification failed with active key'));
          }
          // Si no tiene kid, intentamos con las claves retenidas como fallback
          this.verifyWithRetainedKeys(token, resolve, reject);
        });
        return;
      }

      // 2. Intentar validar con la clave retenida correspondiente al kid
      const retained = this.retainedKeys.get(kid);
      if (retained) {
        const verifyOpts: VerifyOptions = { algorithms: ['RS256'] };
        jwt.verify(token, retained.publicKeyPem, verifyOpts, (err, decoded) => {
          if (err || !decoded) {
            return reject(err ?? new Error(`Token verification failed with retained key '${kid}'`));
          }
          resolve(decoded as T);
        });
        return;
      }

      // 3. Clave desconocida o ventana de gracia expirada
      reject(new Error(`Token verification failed: key '${kid}' not found or grace period expired`));
    });
  }

  public toString(): string {
    return `RsaKeyAdapter(kid=${this.activeKeyId.getValue()}, retainedCount=${this.retainedKeys.size}, privateKey=[REDACTED])`;
  }

  public [util.inspect.custom](): Record<string, unknown> {
    return {
      activeKeyId: this.activeKeyId.getValue(),
      retainedKeysCount: this.retainedKeys.size,
      privateKey: '[REDACTED]',
      publicKey: this.activePublicKeyPem,
      defaultExpiresIn: this.defaultExpiresIn,
    };
  }

  private buildJwkDto(keyId: KeyId, publicKeyPem: string): JsonWebKeyDto {
    const keyObject = crypto.createPublicKey(publicKeyPem);
    const jwkData = keyObject.export({ format: 'jwk' });

    if (!jwkData.n || !jwkData.e) {
      throw new Error('Failed to extract modulus (n) and exponent (e) from public key');
    }

    const jwkVo = JsonWebKeyVO.create({
      kty: 'RSA',
      use: 'sig',
      alg: 'RS256',
      kid: keyId,
      n: jwkData.n,
      e: jwkData.e,
    });

    return jwkVo.toDto();
  }

  private purgeExpiredKeys(): void {
    const now = Date.now();
    for (const [kid, retained] of this.retainedKeys.entries()) {
      if (now > retained.expiresAt) {
        this.retainedKeys.delete(kid);
      }
    }
  }

  private verifyWithRetainedKeys(
    token: string,
    resolve: (value: any) => void,
    reject: (reason?: any) => void
  ): void {
    const candidates = Array.from(this.retainedKeys.values());
    if (candidates.length === 0) {
      return reject(new Error('Token verification failed: no matching public key found'));
    }

    let errorToReport: any = null;
    for (const retained of candidates) {
      try {
        const decoded = jwt.verify(token, retained.publicKeyPem, { algorithms: ['RS256'] });
        return resolve(decoded);
      } catch (err) {
        errorToReport = err;
      }
    }

    reject(errorToReport ?? new Error('Token verification failed against all retained keys'));
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
