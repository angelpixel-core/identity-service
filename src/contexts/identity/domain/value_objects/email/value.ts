import { DomainValidationError } from '../../exceptions/user/error';

/**
 * Value Object: Email
 * Inmutable, normalizado (lowercase, trimmed) y validado según formato estándar RFC 5322.
 */
export class Email {
  private static readonly EMAIL_REGEX =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

  private readonly value: string;

  private constructor(value: string) {
    this.value = Object.freeze(value);
    Object.freeze(this);
  }

  public static create(rawEmail: string): Email {
    if (!rawEmail || typeof rawEmail !== 'string') {
      throw new DomainValidationError('Email must be a non-empty string');
    }

    const trimmed = rawEmail.trim();
    if (trimmed.length === 0) {
      throw new DomainValidationError('Email cannot be empty or whitespace');
    }

    const normalized = trimmed.toLowerCase();

    if (!Email.EMAIL_REGEX.test(normalized)) {
      throw new DomainValidationError(`Invalid email format: "${trimmed}" does not satisfy RFC 5322`);
    }

    return new Email(normalized);
  }

  public getValue(): string {
    return this.value;
  }

  public equals(other: Email): boolean {
    if (!other || !(other instanceof Email)) {
      return false;
    }
    return this.value === other.getValue();
  }

  public toString(): string {
    return this.value;
  }
}

