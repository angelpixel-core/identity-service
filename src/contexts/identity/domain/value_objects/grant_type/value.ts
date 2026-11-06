import { DomainValidationError } from '../../exceptions/user/error';

export type AllowedGrantTypeValue = 'authorization_code' | 'refresh_token' | 'client_credentials';

/**
 * Value Object: GrantType
 * Representa un flujo de concesión OAuth 2.0 soportado oficialmente por el Identity Provider.
 */
export class GrantType {
  public static readonly VALID_GRANT_TYPES: readonly AllowedGrantTypeValue[] = [
    'authorization_code',
    'refresh_token',
    'client_credentials',
  ];

  private readonly value: AllowedGrantTypeValue;

  private constructor(value: AllowedGrantTypeValue) {
    this.value = Object.freeze(value);
    Object.freeze(this);
  }

  public static create(rawGrantType: string): GrantType {
    if (!rawGrantType || typeof rawGrantType !== 'string') {
      throw new DomainValidationError('GrantType must be a non-empty string');
    }

    const normalized = rawGrantType.trim().toLowerCase();
    if (normalized.length === 0) {
      throw new DomainValidationError('GrantType cannot be empty or whitespace');
    }

    if (!GrantType.VALID_GRANT_TYPES.includes(normalized as AllowedGrantTypeValue)) {
      throw new DomainValidationError(
        `Unsupported OAuth2 grant_type: "${normalized}". Supported values: ${GrantType.VALID_GRANT_TYPES.join(', ')}.`
      );
    }

    return new GrantType(normalized as AllowedGrantTypeValue);
  }

  public getValue(): AllowedGrantTypeValue {
    return this.value;
  }

  public equals(other: GrantType): boolean {
    if (!other || !(other instanceof GrantType)) {
      return false;
    }
    return this.value === other.getValue();
  }

  public toString(): string {
    return this.value;
  }
}

