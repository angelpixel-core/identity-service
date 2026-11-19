import { Request, Response, NextFunction } from 'express';
import { SecurityAuditLoggerPort } from '../../../src/contexts/identity/application/ports/security/audit_logger';
import { TenantId } from '../../../src/contexts/identity/domain/value_objects/tenant_id/value';

/**
 * Middleware Zero-Trust Guard & Security Audit Logger (US-06 & ADR-0005 & ADR-0009).
 * Detecta intentos de mutación o lectura cross-tenant comparando el tenantId
 * autenticado en el token JWT con cualquier parámetro de URL, query o payload del body.
 *
 * Si el solicitante es un operador del Root Tenant ('system') con rol 'superadmin',
 * se concede el acceso de forma delegada y se audita bajo PCI-DSS 10.2.2 / SOC 2 CC6.1
 * como PLATFORM_OPERATOR_CROSS_TENANT_ACTION.
 *
 * Para cualquier otro actor, registra el evento estructurado CROSS_TENANT_VIOLATION
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
      const isRootSuperadmin =
        (req.isRootAdmin === true || activeTenantId === TenantId.ROOT_TENANT_ID) &&
        Boolean(req.userRoles?.includes('superadmin'));

      if (isRootSuperadmin) {
        if (auditLogger) {
          await auditLogger.logEvent({
            eventType: 'platform_operator_cross_tenant_action',
            severity: 'WARN',
            status: 'GRANTED_ELEVATED',
            timestamp: new Date(),
            tenantId: attemptedTenantId,
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
              pciRequirement: '10.2.2',
              soc2Criteria: 'CC6.1',
              retentionCategory: 'AUDIT_IMMUTABLE',
            },
            action: 'platform_operator_cross_tenant_delegation',
            ip: req.ip,
            reason: 'PLATFORM_OPERATOR_CROSS_TENANT_ACTION',
            metadata: {
              operatorTenantId: TenantId.ROOT_TENANT_ID,
              targetTenantId: attemptedTenantId,
              userId: req.userId,
              path: req.originalUrl,
              method: req.method,
            },
          });
        }

        next();
        return;
      }

      if (auditLogger) {
        await auditLogger.logEvent({
          eventType: 'cross_tenant_violation',
          severity: 'ALERT',
          status: 'DENIED',
          timestamp: new Date(),
          tenantId: activeTenantId,
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
            soc2Criteria: 'CC7.2',
            retentionCategory: 'AUDIT_IMMUTABLE',
          },
          action: 'cross_tenant_access_denied',
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
