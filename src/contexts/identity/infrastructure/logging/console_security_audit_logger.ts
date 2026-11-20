import {
  CanonicalSecurityAuditEvent,
  SecurityAuditEvent,
  SecurityAuditLoggerPort,
  SecurityAuditQueryFilters,
} from '../../application/ports/security/audit_logger';
import { buildCanonicalAuditEvent } from '../../application/security/audit_event_builder';

export interface ConsoleSecurityAuditLoggerOptions {
  readonly outputStream?: NodeJS.WritableStream;
  readonly maxRecentEvents?: number;
}

const DEFAULT_MAX_RECENT_EVENTS = 500;

/**
 * Secondary Adapter: ConsoleSecurityAuditLogger
 * Emite eventos de auditoría de seguridad bancaria en formato estructurado NDJSON
 * directamente a stdout (12-Factor App) para recolección por Azure Monitor / Fluentbit,
 * reteniendo un ring-buffer inmutable acotado en memoria para inspección operativa (US-19).
 * Cumplimiento: PCI-DSS v4.0 Req 10.2 / 10.5 y SOC 2 CC7.2.
 */
export class ConsoleSecurityAuditLogger implements SecurityAuditLoggerPort {
  private readonly outputStream: NodeJS.WritableStream;
  private readonly maxRecentEvents: number;
  private readonly recentEvents: CanonicalSecurityAuditEvent[] = [];

  constructor(options?: ConsoleSecurityAuditLoggerOptions) {
    this.outputStream = options?.outputStream ?? process.stdout;
    this.maxRecentEvents = Math.max(1, options?.maxRecentEvents ?? DEFAULT_MAX_RECENT_EVENTS);

    // Salvaguarda fail-safe: prevenir crashes no controlados por EPIPE o errores de stream (máximo 1 listener por stream)
    if (
      typeof (this.outputStream as any).on === 'function' &&
      (typeof (this.outputStream as any).listenerCount !== 'function' ||
        (this.outputStream as any).listenerCount('error') === 0)
    ) {
      (this.outputStream as any).on('error', (err: unknown) => {
        try {
          process.stderr.write(
            `[AUDIT_LOG_STREAM_ERROR] Stream error encountered: ${
              err instanceof Error ? err.message : String(err)
            }\n`
          );
        } catch {
          // No-op defensivo
        }
      });
    }
  }

  public async logEvent(event: SecurityAuditEvent): Promise<void> {
    try {
      const canonicalEvent = buildCanonicalAuditEvent(event);
      this.recentEvents.push(canonicalEvent);
      if (this.recentEvents.length > this.maxRecentEvents) {
        this.recentEvents.shift();
      }

      const ndjson = JSON.stringify(canonicalEvent);
      this.outputStream.write(`${ndjson}\n`, (error) => {
        if (error) {
          try {
            process.stderr.write(
              `[AUDIT_LOG_WRITE_ERROR] Failed to write security audit event: ${error.message}\n`
            );
          } catch {
            // No-op defensivo
          }
        }
      });
    } catch (error) {
      // Fail-safe: las fallas de serialización o formateo no deben abortar la transacción de negocio
      try {
        process.stderr.write(
          `[AUDIT_LOG_SERIALIZATION_ERROR] Failed to emit security audit event: ${
            error instanceof Error ? error.message : String(error)
          }\n`
        );
      } catch {
        // No-op defensivo
      }
    }
  }

  public getRecentEvents(filters?: SecurityAuditQueryFilters): CanonicalSecurityAuditEvent[] {
    const limit = Math.min(200, Math.max(1, filters?.limit ?? 50));
    const tenantFilter = filters?.tenantId?.trim();
    const severityFilter = filters?.severity?.trim().toUpperCase();
    const eventTypeFilter = filters?.eventType?.trim().toUpperCase();

    const matched: CanonicalSecurityAuditEvent[] = [];
    for (let i = this.recentEvents.length - 1; i >= 0 && matched.length < limit; i -= 1) {
      const ev = this.recentEvents[i];
      if (!ev) continue;
      if (tenantFilter && ev.tenantId !== tenantFilter) continue;
      if (severityFilter && ev.severity.toUpperCase() !== severityFilter) continue;
      if (eventTypeFilter && ev.eventType.toUpperCase() !== eventTypeFilter) continue;
      matched.push(ev);
    }
    return matched;
  }

  public getBufferCapacity(): number {
    return this.maxRecentEvents;
  }
}
