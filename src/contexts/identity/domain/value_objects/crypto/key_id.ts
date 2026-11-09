import { DomainValidationError } from '../../exceptions/user/error';

/**
 * Value Object: KeyId
 * Identificador criptográfico (`kid`) inmutable y normalizado para pares de claves asimétricas (RFC 7517).
 */
export class KeyId {
  private static readonly KID_REGEX = /^[a-zA-Z0-9_\-.:]+$/;
  private static readonly MIN_LENGTH = 3;
  private static readonly MAX_LENGTH = 128;

  private readonly value: string;

  private constructor(value: string) {
    this.value = Object.freeze(value);
    Object.freeze(this);
  }

  public static create(rawKeyId: string): KeyId {
    if (!rawKeyId || typeof rawKeyId !== 'string') {
      throw new DomainValidationError('KeyId must be a non-empty string');
    }

    const trimmed = rawKeyId.trim();
    if (trimmed.length === 0) {
      throw new DomainValidationError('KeyId cannot be empty or whitespace');
    }

    if (trimmed.length < KeyId.MIN_LENGTH) {
      throw new DomainValidationError(
        `KeyId "${trimmed}" is too short. Minimum length is ${KeyId.MIN_LENGTH} characters.`
      );
    }

    if (trimmed.length > KeyId.MAX_LENGTH) {
      throw new DomainValidationError(
        `KeyId is too long. Maximum length is ${KeyId.MAX_LENGTH} characters.`
      );
    }

    if (!KeyId.KID_REGEX.test(trimmed)) {
      throw new DomainValidationError(
        `Invalid KeyId format: "${trimmed}". Allowed characters: alphanumeric, hyphens, underscores, dots, colons.`
      );
    }

    return new KeyId(trimmed);
  }

  public getValue(): string {
    return this.value;
  }

  public equals(other: unknown): boolean {
    if (!other || !(other instanceof KeyId)) {
      return false;
    }
    return this.value === other.getValue();
  }

  public toString(): string {
    return this.value;
  }
}

