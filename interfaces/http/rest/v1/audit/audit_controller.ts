import type { Request, Response, NextFunction } from 'express';
import type {
  SecurityAuditLoggerPort,
  SecurityAuditQueryFilters,
  SecurityAuditSeverity,
} from '../../../../../src/contexts/identity/application/ports/security/audit_logger';

const ALLOWED_SEVERITIES: ReadonlySet<string> = new Set([
  'INFO',
  'WARN',
  'ERROR',
  'ALERT',
  'CRITICAL',
]);

export interface AuditControllerDeps {
  readonly auditLogger: SecurityAuditLoggerPort;
}

/**
 * REST Driver Controller: AuditController (US-19 & ADR-0009)
 * Expone la consulta e inspección en tiempo real de eventos canónicos de auditoría
 * de seguridad (PCI-DSS v4.0 Req 10.2/10.5 y SOC 2 CC6.8/CC7.2), protegida
 * exclusivamente para operadores del Root Tenant ('system' + rol 'superadmin').
 */
export class AuditController {
  constructor(private readonly deps: AuditControllerDeps) {}

  public getEvents = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId =
        typeof req.query.tenantId === 'string' && req.query.tenantId.trim().length > 0
          ? req.query.tenantId.trim()
          : undefined;

      const rawSeverity =
        typeof req.query.severity === 'string' && req.query.severity.trim().length > 0
          ? req.query.severity.trim().toUpperCase()
          : undefined;

      if (rawSeverity && !ALLOWED_SEVERITIES.has(rawSeverity)) {
        res.status(400).json({
          error: 'invalid_severity',
          message: `Invalid severity '${rawSeverity}'. Allowed values: INFO, WARN, ERROR, ALERT, CRITICAL`,
        });
        return;
      }

      const eventType =
        typeof req.query.eventType === 'string' && req.query.eventType.trim().length > 0
          ? req.query.eventType.trim().toUpperCase()
          : undefined;

      const rawLimit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50;
      const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, rawLimit)) : 50;

      const format =
        typeof req.query.format === 'string' && req.query.format.trim().length > 0
          ? req.query.format.trim().toLowerCase()
          : 'json';

      if (format !== 'json' && format !== 'ndjson') {
        res.status(400).json({
          error: 'invalid_format',
          message: `Invalid format '${format}'. Allowed values: json, ndjson`,
        });
        return;
      }

      const filters: SecurityAuditQueryFilters = {
        tenantId,
        severity: rawSeverity as SecurityAuditSeverity | undefined,
        eventType,
        limit,
      };

      const events =
        typeof this.deps.auditLogger.getRecentEvents === 'function'
          ? this.deps.auditLogger.getRecentEvents(filters)
          : [];

      if (format === 'ndjson') {
        res.status(200);
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        const payload = events.length > 0 ? `${events.map((e) => JSON.stringify(e)).join('\n')}\n` : '';
        res.send(payload);
        return;
      }

      const bufferMax =
        typeof (this.deps.auditLogger as any).getBufferCapacity === 'function'
          ? (this.deps.auditLogger as any).getBufferCapacity()
          : 500;

      res.status(200).json({
        status: 'ACTIVE',
        source: 'IN_PROCESS_SECURITY_AUDIT_RING_BUFFER',
        retentionPolicy: {
          inProcessBufferMax: bufferMax,
          cloudWormRetentionDays: 365,
          targetTable: 'IdentitySecurityAudit_CL',
        },
        count: events.length,
        filters: {
          ...(tenantId ? { tenantId } : {}),
          ...(rawSeverity ? { severity: rawSeverity } : {}),
          ...(eventType ? { eventType } : {}),
          limit,
        },
        events,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  };
}
