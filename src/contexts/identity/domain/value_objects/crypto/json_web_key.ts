import { DomainValidationError } from '../../exceptions/user/error';
import { JsonWebKeyDto } from '../../ports/crypto/asymmetric_key_provider_port';
import { KeyId } from './key_id';

export interface CreateJsonWebKeyProps {
  readonly kty: string;
  readonly use: string;
  readonly alg: string;
  readonly kid: string | KeyId;
  readonly n: string;
  readonly e: string;
  readonly [key: string]: unknown;
}

/**
 * Value Object: JsonWebKeyVO
 * Encapsula la representación inmutable de una clave pública RSA conforme a RFC 7517.
 * Garantiza invariantes estrictas de seguridad (algoritmo RS256, uso para firma,
 * y ausencia absoluta de componentes criptográficos privados).
 */
export class JsonWebKeyVO {
  private static readonly FORBIDDEN_PRIVATE_PARAMS = [
    'd',
    'p',
    'q',
    'dp',
    'dq',
    'qi',
    'oth',
  ] as const;

  private readonly kid: KeyId;
  private readonly n: string;
  private readonly e: string;

  private constructor(kid: KeyId, n: string, e: string) {
    this.kid = kid;
    this.n = Object.freeze(n);
    this.e = Object.freeze(e);
    Object.freeze(this);
  }

  public static create(props: CreateJsonWebKeyProps): JsonWebKeyVO {
    if (!props || typeof props !== 'object') {
      throw new DomainValidationError('JWK properties must be an object');
    }

    // Comprobación de seguridad: Ningún parámetro de clave privada debe filtrarse en un JWK público
    for (const privateParam of JsonWebKeyVO.FORBIDDEN_PRIVATE_PARAMS) {
      if (privateParam in props && props[privateParam] !== undefined) {
        throw new DomainValidationError(
          `Security violation: Private key parameter "${privateParam}" detected. Private parameters must never be exported in public JWK.`
        );
      }
    }

    if (props.kty !== 'RSA') {
      throw new DomainValidationError(`Invalid key type (kty): "${props.kty}". Expected "RSA".`);
    }

    if (props.use !== 'sig') {
      throw new DomainValidationError(`Invalid key use: "${props.use}". Expected "sig".`);
    }

    if (props.alg !== 'RS256') {
      throw new DomainValidationError(`Invalid algorithm (alg): "${props.alg}". Expected "RS256".`);
    }

    if (!props.n || typeof props.n !== 'string' || props.n.trim().length === 0) {
      throw new DomainValidationError('Public key modulus (n) must be a non-empty base64url string');
    }

    if (!props.e || typeof props.e !== 'string' || props.e.trim().length === 0) {
      throw new DomainValidationError('Public key exponent (e) must be a non-empty string');
    }

    const kid =
      props.kid instanceof KeyId
        ? props.kid
        : KeyId.create(typeof props.kid === 'string' ? props.kid : '');

    return new JsonWebKeyVO(kid, props.n.trim(), props.e.trim());
  }

  public getKid(): KeyId {
    return this.kid;
  }

  public getModulus(): string {
    return this.n;
  }

  public getExponent(): string {
    return this.e;
  }

  public toDto(): JsonWebKeyDto {
    return Object.freeze({
      kty: 'RSA' as const,
      use: 'sig' as const,
      alg: 'RS256' as const,
      kid: this.kid.getValue(),
      n: this.n,
      e: this.e,
    });
  }

  public equals(other: unknown): boolean {
    if (!other || !(other instanceof JsonWebKeyVO)) {
      return false;
    }
    return (
      this.kid.equals(other.kid) &&
      this.n === other.n &&
      this.e === other.e
    );
  }

  public toJSON(): JsonWebKeyDto {
    return this.toDto();
  }
}

