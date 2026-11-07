import {
  SecurityAuditEvent,
  SecurityAuditLoggerPort,
} from '../../application/ports/security/audit_logger';

/**
 * Secondary Adapter: InMemorySecurityAuditLogger
 * Implementación en memoria del puerto de auditoría de seguridad para testing y entornos locales.
 */
export class InMemorySecurityAuditLogger implements SecurityAuditLoggerPort {
  private readonly events: SecurityAuditEvent[] = [];

  public async logEvent(event: SecurityAuditEvent): Promise<void> {
    this.events.push(Object.freeze({ ...event }));
  }

  public getEvents(): SecurityAuditEvent[] {
    return [...this.events];
  }

  public getEventsByClientId(clientId: string): SecurityAuditEvent[] {
    return this.events.filter((e) => e.clientId === clientId);
  }

  public clear(): void {
    this.events.length = 0;
  }
}

