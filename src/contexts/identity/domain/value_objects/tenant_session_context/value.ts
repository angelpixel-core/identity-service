import { TenantId } from '../tenant_id/value';
import { DomainValidationError } from '../../exceptions/user/error';
import { CrossTenantContextViolationError } from '../../exceptions/security/error';

/**
 * Value Object: TenantSessionContext
 * Representa el contexto de sesión activa de un tenant para la ejecución transaccional.
 *
 * Propiedades de Dominio:
 * 1. Inmutable y congelado (Object.freeze).
 * 2. Encapsula un TenantId validado.
 * 3. Provee aserción estricta de aislamiento (assertMatchingTenant) lanzando
 *    CrossTenantContextViolationError si se detecta un intento de colisión cross-tenant.
 */
export class TenantSessionContext {
  private readonly tenantId: TenantId;

  private constructor(tenantId: TenantId) {
    this.tenantId = tenantId;
    Object.freeze(this);
  }

  /**
   * Factory para crear un TenantSessionContext a partir de un TenantId o string.
   */
  public static create(tenantId: TenantId | string): TenantSessionContext {
    if (!tenantId) {
      throw new DomainValidationError('TenantSessionContext requires a non-empty tenant identifier');
    }

    const resolvedTenantId =
      tenantId instanceof TenantId ? tenantId : TenantId.create(tenantId);

    return new TenantSessionContext(resolvedTenantId);
  }

  public getTenantId(): TenantId {
    return this.tenantId;
  }

  public getTenantIdValue(): string {
    return this.tenantId.getValue();
  }

  public equals(other: unknown): boolean {
    if (!other || !(other instanceof TenantSessionContext)) {
      return false;
    }
    return this.tenantId.equals(other.getTenantId());
  }

  /**
   * Verifica que el tenant destino coincida estrictamente con el tenant de la sesión activa.
   * Lanza CrossTenantContextViolationError si hay discrepancia.
   */
  public assertMatchingTenant(targetTenant: TenantId | string): void {
    if (!targetTenant) {
      throw new DomainValidationError('Target tenant identifier cannot be empty');
    }

    const targetValue =
      targetTenant instanceof TenantId ? targetTenant.getValue() : targetTenant.trim();

    if (this.tenantId.getValue() !== targetValue) {
      throw new CrossTenantContextViolationError(
        this.tenantId.getValue(),
        targetValue
      );
    }
  }

  public toString(): string {
    return `TenantSessionContext(${this.tenantId.getValue()})`;
  }
}