import { Request, Response, NextFunction } from 'express';
import { SecurityAuditLoggerPort } from '../../../src/contexts/identity/application/ports/security/audit_logger';

/**
 * Middleware Zero-Trust Guard & Security Audit Logger (US-06 & ADR-0005).
 * Detecta intentos de mutación o lectura cross-tenant comparando el tenantId
 * autenticado en el token JWT con cualquier parámetro de URL, query o payload del body.
 * Si detecta divergencia, registra el evento estructurado CROSS_TENANT_VIOLATION
 * y aborta inmediatamente la operación con HTTP 403 Forbidden.
 */
export function createCrossTenantGuard(auditLogger?: SecurityAuditLoggerPort) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const activeTenantId = req.tenantId;

    if (!activeTenantId) {
      next();
      return;
    }

    const bodyTenantId =
      typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : undefined;
    const paramTenantId =
      typeof req.params?.tenantId === 'string' ? req.params.tenantId.trim() : undefined;
    const queryTenantId =
      typeof req.query?.tenantId === 'string' ? req.query.tenantId.trim() : undefined;

    const attemptedTenantId = bodyTenantId || paramTenantId || queryTenantId;

    if (attemptedTenantId && attemptedTenantId !== activeTenantId) {
      if (auditLogger) {
        await auditLogger.logEvent({
          eventType: 'cross_tenant_violation',
          timestamp: new Date(),
          ip: req.ip,
          reason: 'CROSS_TENANT_VIOLATION',
          metadata: {
            activeTenantId,
            attemptedTenantId,
            userId: req.userId,
            path: req.originalUrl,
            method: req.method,
          },
        });
      }

      res.status(403).json({
        error: 'Forbidden: Cross-tenant access violation detected',
      });
      return;
    }

    next();
  };
}

export const securityAuditLoggerMiddleware = createCrossTenantGuard;
