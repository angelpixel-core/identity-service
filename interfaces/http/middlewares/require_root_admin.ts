import type { Request, Response, NextFunction } from 'express';
import type { SecurityAuditLoggerPort } from '../../../src/contexts/identity/application/ports/security/audit_logger';
import { TenantId } from '../../../src/contexts/identity/domain/value_objects/tenant_id/value';

/**
 * Middleware Zero-Trust de Gobernanza de Plataforma (ADR-0009).
 * Restringe el acceso a endpoints de plano de control (e.g. /api/v1/secrets/*)
 * exclusivamente a operadores autenticados del Root Tenant ('system') con rol 'superadmin'.
 */
export function createRequireRootAdminMiddleware(auditLogger?: SecurityAuditLoggerPort) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const isRootSuperadmin =
      req.isRootAdmin === true &&
      Array.isArray(req.userRoles) &&
      req.userRoles.includes('superadmin');

    if (!isRootSuperadmin) {
      if (auditLogger) {
        await auditLogger.logEvent({
          eventType: 'CROSS_TENANT_VIOLATION',
          severity: 'ALERT',
          status: 'DENIED',
          timestamp: new Date(),
          tenantId: req.tenantId || 'unknown',
          actor: {
            userId: req.userId,
            type: 'USER',
            ip: req.ip,
          },
          trace: {
            requestId:
              (req.headers && (req.headers['x-request-id'] as string)) ||
              (req as any).id,
            correlationId:
              req.headers && (req.headers['x-correlation-id'] as string),
          },
          compliance: {
            pciRequirement: '10.2.5',
            soc2Criteria: 'CC6.1',
            retentionCategory: 'AUDIT_IMMUTABLE',
          },
          action: 'platform_governance_access_denied',
          ip: req.ip,
          reason: 'ROOT_SUPERADMIN_REQUIRED',
          metadata: {
            requiredTenantId: TenantId.ROOT_TENANT_ID,
            requiredRole: 'superadmin',
            actualTenantId: req.tenantId,
            actualRoles: req.userRoles || [],
            path: req.originalUrl,
            method: req.method,
          },
        });
      }

      res.status(403).json({
        error: 'Forbidden: Platform governance operations require Root Tenant (system) superadmin privileges',
      });
      return;
    }

    next();
  };
}
