import { DomainValidationError } from '../../exceptions/user/error';

/**
 * Value Object: ClientId
 * Identificador único, inmutable y normalizado para aplicaciones cliente registradas.
 */
export class ClientId {
  private static readonly CLIENT_ID_REGEX = /^[a-zA-Z0-9_-]+$/;
  private static readonly MIN_LENGTH = 3;

  private readonly value: string;

  private constructor(value: string) {
    this.value = Object.freeze(value);
    Object.freeze(this);
  }

  public static create(rawClientId: string): ClientId {
    if (!rawClientId || typeof rawClientId !== 'string') {
      throw new DomainValidationError('ClientId must be a non-empty string');
    }

    const trimmed = rawClientId.trim();
    if (trimmed.length === 0) {
      throw new DomainValidationError('ClientId cannot be empty or whitespace');
    }

    if (trimmed.length < ClientId.MIN_LENGTH) {
      throw new DomainValidationError(
        `ClientId "${trimmed}" is too short. Minimum length is ${ClientId.MIN_LENGTH} characters.`
      );
    }

    if (!ClientId.CLIENT_ID_REGEX.test(trimmed)) {
      throw new DomainValidationError(
        `Invalid ClientId format: "${trimmed}". Only alphanumeric characters, hyphens, and underscores are allowed.`
      );
    }

    return new ClientId(trimmed.toLowerCase());
  }

  public getValue(): string {
    return this.value;
  }

  public equals(other: ClientId): boolean {
    if (!other || !(other instanceof ClientId)) {
      return false;
    }
    return this.value === other.getValue();
  }

  public toString(): string {
    return this.value;
  }
}

