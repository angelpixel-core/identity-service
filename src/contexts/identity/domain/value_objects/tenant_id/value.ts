import { DomainValidationError } from '../../exceptions/user/error';

/**
 * Value Object: TenantId
 * Inmutable, normalizado (trimmed) y validado para aislamiento de organizaciones.
 */
export class TenantId {
  private static readonly TENANT_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

  private readonly value: string;

  private constructor(value: string) {
    this.value = Object.freeze(value);
    Object.freeze(this);
  }

  public static create(rawTenantId: string): TenantId {
    if (!rawTenantId || typeof rawTenantId !== 'string') {
      throw new DomainValidationError('TenantId must be a non-empty string');
    }

    const trimmed = rawTenantId.trim();
    if (trimmed.length === 0) {
      throw new DomainValidationError('TenantId cannot be empty or whitespace');
    }

    if (!TenantId.TENANT_ID_REGEX.test(trimmed)) {
      throw new DomainValidationError(
        `Invalid tenantId format: "${trimmed}". Only alphanumeric characters, hyphens, and underscores are allowed.`
      );
    }

    return new TenantId(trimmed);
  }

  public getValue(): string {
    return this.value;
  }

  public equals(other: TenantId): boolean {
    if (!other || !(other instanceof TenantId)) {
      return false;
    }
    return this.value === other.getValue();
  }

  public toString(): string {
    return this.value;
  }
}

