import { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
    }
  }
}

/**
 * Middleware de extracción y validación de contexto multitenant.
 * Inspecciona el encabezado 'x-tenant-id' en cada petición entrante conforme a ADR-0003.
 */
export function tenantContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const rawTenant = req.headers['x-tenant-id'] || req.body?.tenantId;

  if (!rawTenant || typeof rawTenant !== 'string' || rawTenant.trim().length === 0) {
    res.status(400).json({
      error: 'Missing or empty required header: x-tenant-id',
    });
    return;
  }

  const sanitizedTenant = rawTenant.trim();

  // Validación de caracteres permitidos para TenantId
  if (!/^[a-zA-Z0-9_-]+$/.test(sanitizedTenant)) {
    res.status(400).json({
      error: 'Invalid tenantId format in x-tenant-id header',
    });
    return;
  }

  req.tenantId = sanitizedTenant;
  next();
}
