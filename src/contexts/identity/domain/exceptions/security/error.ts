import { DomainError } from '../user/error';

/**
 * Excepción de Dominio: CrossTenantContextViolationError
 * Se dispara cuando se detecta un intento de conmutar, anidar o acceder
 * a recursos de un tenant distinto dentro de una misma sesión o contexto transaccional activo.
 */
export class CrossTenantContextViolationError extends DomainError {
  public readonly code = 'cross_tenant_context_violation';

  constructor(
    public readonly activeTenantId: string,
    public readonly attemptedTenantId: string,
    message?: string
  ) {
    super(
      message ||
        `Cross-tenant context violation detected: active tenant '${activeTenantId}' cannot execute operations for target tenant '${attemptedTenantId}'.`
    );
  }
}
