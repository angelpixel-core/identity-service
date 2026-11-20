import {
  CanonicalSecurityAuditEvent,
  SecurityAuditEvent,
  SecurityAuditLoggerPort,
  SecurityAuditQueryFilters,
} from '../../application/ports/security/audit_logger';
import { buildCanonicalAuditEvent } from '../../application/security/audit_event_builder';

/**
 * Secondary Adapter: InMemorySecurityAuditLogger
 * Implementación en memoria del puerto de auditoría de seguridad para testing y entornos locales.
 */
export class InMemorySecurityAuditLogger implements SecurityAuditLoggerPort {
  private readonly events: SecurityAuditEvent[] = [];
  private readonly canonicalEvents: CanonicalSecurityAuditEvent[] = [];

  public async logEvent(event: SecurityAuditEvent): Promise<void> {
    this.events.push(Object.freeze({ ...event }));
    this.canonicalEvents.push(buildCanonicalAuditEvent(event));
  }

  public getEvents(): SecurityAuditEvent[] {
    return [...this.events];
  }

  public getRecentEvents(filters?: SecurityAuditQueryFilters): CanonicalSecurityAuditEvent[] {
    const limit = Math.min(200, Math.max(1, filters?.limit ?? 50));
    const tenantFilter = filters?.tenantId?.trim();
    const severityFilter = filters?.severity?.trim().toUpperCase();
    const eventTypeFilter = filters?.eventType?.trim().toUpperCase();

    const matched: CanonicalSecurityAuditEvent[] = [];
    for (let i = this.canonicalEvents.length - 1; i >= 0 && matched.length < limit; i -= 1) {
      const ev = this.canonicalEvents[i];
      if (!ev) continue;
      if (tenantFilter && ev.tenantId !== tenantFilter) continue;
      if (severityFilter && ev.severity.toUpperCase() !== severityFilter) continue;
      if (eventTypeFilter && ev.eventType.toUpperCase() !== eventTypeFilter) continue;
      matched.push(ev);
    }
    return matched;
  }

  public getEventsByClientId(clientId: string): SecurityAuditEvent[] {
    return this.events.filter((e) => e.clientId === clientId);
  }

  public clear(): void {
    this.events.length = 0;
    this.canonicalEvents.length = 0;
  }
}

