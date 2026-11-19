import { DomainValidationError } from '../../exceptions/user/error';

/**
 * Value Object: TenantId
 * Inmutable, normalizado (trimmed) y validado para aislamiento de organizaciones.
 */
export class TenantId {
  public static readonly ROOT_TENANT_ID = process.env.ROOT_TENANT_ID || 'system';
  private static readonly TENANT_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

  private readonly value: string;

  private constructor(value: string) {
    this.value = Object.freeze(value);
    Object.freeze(this);
  }

  /**
   * Factory para obtener una instancia inmutable del Inquilino Raíz ('system').
   */
  public static root(): TenantId {
    return new TenantId(TenantId.ROOT_TENANT_ID);
  }

  /**
   * Determina si este identificador corresponde al Inquilino Raíz de la plataforma.
   */
  public isRoot(): boolean {
    return this.value === TenantId.ROOT_TENANT_ID;
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

