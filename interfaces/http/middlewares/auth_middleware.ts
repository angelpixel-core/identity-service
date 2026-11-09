import { Request, Response, NextFunction } from 'express';
import { TokenProviderPort } from '../../../src/contexts/identity/application/ports/security/token_provider';
import { SecurityAuditLoggerPort } from '../../../src/contexts/identity/application/ports/security/audit_logger';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
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

      // Verificación estricta de aislamiento multi-tenant:
      // Si la petición define un x-tenant-id, debe coincidir con el tenant asignado en el token
      if (req.tenantId && claims.tenantId && req.tenantId !== claims.tenantId) {
        if (auditLogger) {
          await auditLogger.logEvent({
            eventType: 'cross_tenant_violation',
            timestamp: new Date(),
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

      req.userId = claims.userId;
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