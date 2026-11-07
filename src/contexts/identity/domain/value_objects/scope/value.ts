import { DomainValidationError } from '../../exceptions/user/error';

/**
 * Value Object: Scope
 * Representa un alcance de permisos OAuth2 / OIDC (ej. 'openid', 'profile', 'identity:read').
 */
export class Scope {
  private static readonly SCOPE_REGEX = /^[a-zA-Z0-9:_-]+$/;
  private static readonly MIN_LENGTH = 2;

  private readonly value: string;

  private constructor(value: string) {
    this.value = Object.freeze(value);
    Object.freeze(this);
  }

  public static create(rawScope: string): Scope {
    if (!rawScope || typeof rawScope !== 'string') {
      throw new DomainValidationError('Scope must be a non-empty string');
    }

    const trimmed = rawScope.trim().toLowerCase();
    if (trimmed.length === 0) {
      throw new DomainValidationError('Scope cannot be empty or whitespace');
    }

    if (trimmed.length < Scope.MIN_LENGTH) {
      throw new DomainValidationError(
        `Scope "${trimmed}" is too short. Minimum length is ${Scope.MIN_LENGTH} characters.`
      );
    }

    if (!Scope.SCOPE_REGEX.test(trimmed)) {
      throw new DomainValidationError(
        `Invalid Scope format: "${trimmed}". Only alphanumeric characters, colons, hyphens, and underscores are allowed.`
      );
    }

    return new Scope(trimmed);
  }

  public getValue(): string {
    return this.value;
  }

  public equals(other: Scope): boolean {
    if (!other || !(other instanceof Scope)) {
      return false;
    }
    return this.value === other.getValue();
  }

  public toString(): string {
    return this.value;
  }
}

