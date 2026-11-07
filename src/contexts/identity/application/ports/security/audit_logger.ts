export type SecurityAuditEventType =
  | 'client_authenticated'
  | 'client_authentication_failed';

/**
 * Evento estructurado de auditoría de seguridad para operaciones OAuth2 y autenticación.
 */
export interface SecurityAuditEvent {
  readonly eventType: SecurityAuditEventType;
  readonly clientId?: string;
  readonly timestamp: Date;
  readonly ip?: string;
  readonly reason?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Secondary Port (SPI): SecurityAuditLoggerPort
 * Contrato abstracto para el registro inmutable de eventos de auditoría y seguridad.
 */
export interface SecurityAuditLoggerPort {
  logEvent(event: SecurityAuditEvent): Promise<void>;
}

