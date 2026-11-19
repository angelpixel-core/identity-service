import { Request, Response, NextFunction } from 'express';
import { TokenProviderPort } from '../../../src/contexts/identity/application/ports/security/token_provider';
import { SecurityAuditLoggerPort } from '../../../src/contexts/identity/application/ports/security/audit_logger';
import { TenantId } from '../../../src/contexts/identity/domain/value_objects/tenant_id/value';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userRoles?: string[];
      isRootAdmin?: boolean;
    }
  }
}

/**
 * Middleware factory de autenticación JWT.
 * Inspecciona el encabezado 'Authorization: Bearer <token>', valida la firma y vigencia,
 * y asegura que el token coincida con el contexto de Tenant activo.
 */
export function createAuthMiddleware(
  tokenProvider: TokenProviderPort,
  auditLogger?: SecurityAuditLoggerPort
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers['authorization'];

    if (!authHeader) {
      res.status(401).json({ error: 'Missing Authorization header' });
      return;
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) {
      res.status(401).json({
        error: 'Invalid Authorization header format. Expected "Bearer <token>"',
      });
      return;
    }

    const token = parts[1];

    try {
      const claims = await tokenProvider.verifyToken(token);

      const isRootSuperadmin =
        claims.tenantId === TenantId.ROOT_TENANT_ID &&
        Array.isArray(claims.roles) &&
        claims.roles.includes('superadmin');

      // Verificación estricta de aislamiento multi-tenant:
      // Si la petición define un x-tenant-id, debe coincidir con el tenant asignado en el token,
      // salvo si el actor es un superadmin del root tenant ('system') actuando de forma auditada.
      if (req.tenantId && claims.tenantId && req.tenantId !== claims.tenantId) {
        if (!isRootSuperadmin) {
          if (auditLogger) {
            await auditLogger.logEvent({
              eventType: 'cross_tenant_violation',
              severity: 'ALERT',
              status: 'DENIED',
              timestamp: new Date(),
              tenantId: claims.tenantId,
              actor: {
                userId: claims.userId,
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
                activeTenantId: claims.tenantId,
                attemptedTenantId: req.tenantId,
                userId: claims.userId,
                path: req.originalUrl,
                method: req.method,
              },
            });
          }

          res.status(403).json({
            error: 'Forbidden: Token does not belong to the requested tenant context',
          });
          return;
        }

        // Delegación de Root Superadmin auditada (PCI-DSS 10.2.2 / SOC 2 CC6.1)
        if (auditLogger) {
          await auditLogger.logEvent({
            eventType: 'platform_operator_cross_tenant_action',
            severity: 'WARN',
            status: 'GRANTED_ELEVATED',
            timestamp: new Date(),
            tenantId: req.tenantId,
            actor: {
              userId: claims.userId,
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
              operatorTenantId: claims.tenantId,
              targetTenantId: req.tenantId,
              userId: claims.userId,
              path: req.originalUrl,
              method: req.method,
            },
          });
        }
      }

      req.userId = claims.userId;
      req.userRoles = claims.roles || [];
      req.isRootAdmin = isRootSuperadmin;
      if (!req.tenantId) {
        req.tenantId = claims.tenantId;
      }

      next();
    } catch (_err) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
  };
}