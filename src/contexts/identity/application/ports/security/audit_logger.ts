/**
 * Tipos de eventos de auditoría de seguridad soportados (bancarios y retrocompatibles).
 * Regulados bajo PCI-DSS v4.0 Req 10.2 & 10.5 y SOC 2 Type II CC7.2.
 */
export type SecurityAuditEventType =
  // Eventos bancarios mandatorios (PCI-DSS 10.2 / SOC 2 CC7.2)
  | 'AUTH_LOGIN_SUCCESS'
  | 'AUTH_LOGIN_FAILURE'
  | 'TOKEN_ISSUED'
  | 'TOKEN_REVOKED'
  | 'REFRESH_ROTATED'
  | 'CROSS_TENANT_VIOLATION'
  | 'CLIENT_ORIGIN_DENIED'
  | 'SECRET_ROTATION_SUCCESS'
  | 'SECRET_ROTATION_FAILURE'
  | 'CODE_REUSE_VIOLATION'
  | 'PKCE_VERIFICATION_FAILED'
  | 'REFRESH_TOKEN_REUSE_DETECTED'
  | 'FEDERATION_CALLBACK_PROCESSED'
  | 'FEDERATION_CALLBACK_FAILED'
  | 'PLATFORM_OPERATOR_CROSS_TENANT_ACTION'
  // Compatibilidad hacia atrás (legacy snake_case)
  | 'client_authenticated'
  | 'client_authentication_failed'
  | 'cross_tenant_violation'
  | 'code_reuse_violation'
  | 'pkce_verification_failed'
  | 'refresh_token_reuse_detected'
  | 'federation_callback_processed'
  | 'federation_callback_failed'
  | 'secret_rotation_success'
  | 'secret_rotation_failure'
  | 'platform_operator_cross_tenant_action';

export type SecurityAuditSeverity = 'INFO' | 'WARN' | 'ERROR' | 'ALERT' | 'CRITICAL';

export type SecurityAuditStatus = 'SUCCESS' | 'FAILURE' | 'DENIED' | 'ERROR' | 'GRANTED_ELEVATED';

export interface SecurityAuditActor {
  readonly userId?: string;
  readonly type?: 'USER' | 'CLIENT' | 'SYSTEM' | 'OPERATOR';
  readonly ip?: string;
}

export interface SecurityAuditTrace {
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly traceparent?: string;
}

export interface SecurityAuditCompliance {
  readonly pciRequirement?: string;
  readonly soc2Criteria?: string;
  readonly retentionCategory?: 'AUDIT_IMMUTABLE' | 'GENERAL';
}

/**
 * Evento estructurado de auditoría de seguridad para operaciones OAuth2 y autenticación.
 * Permite tanto la forma extendida bancaria (PCI/SOC2) como los campos legacy.
 */
export interface SecurityAuditEvent {
  readonly logType?: 'SECURITY_AUDIT';
  readonly eventType: SecurityAuditEventType;
  readonly severity?: SecurityAuditSeverity;
  readonly timestamp: Date;
  readonly tenantId?: string;
  readonly actor?: SecurityAuditActor;
  readonly trace?: SecurityAuditTrace;
  readonly compliance?: SecurityAuditCompliance;
  readonly action?: string;
  readonly status?: SecurityAuditStatus;
  readonly details?: Record<string, unknown>;

  // Legacy fields (retrocompatibilidad)
  readonly clientId?: string;
  readonly ip?: string;
  readonly reason?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Evento canónico serializado y enriquecido listo para formato NDJSON de 12 factores.
 */
export interface CanonicalSecurityAuditEvent {
  readonly timestamp: string;
  readonly logType: 'SECURITY_AUDIT';
  readonly eventType: string;
  readonly severity: SecurityAuditSeverity;
  readonly tenantId?: string;
  readonly actor: SecurityAuditActor;
  readonly trace: SecurityAuditTrace;
  readonly compliance: SecurityAuditCompliance;
  readonly action: string;
  readonly status: SecurityAuditStatus;
  readonly details: Record<string, unknown>;
}

/**
 * Filtros de consulta para inspección en tiempo de ejecución de eventos de auditoría (US-19).
 */
export interface SecurityAuditQueryFilters {
  readonly tenantId?: string;
  readonly severity?: SecurityAuditSeverity;
  readonly eventType?: string;
  readonly limit?: number;
}

/**
 * Secondary Port (SPI): SecurityAuditLoggerPort
 * Contrato abstracto para el registro inmutable de eventos de auditoría y seguridad.
 */
export interface SecurityAuditLoggerPort {
  logEvent(event: SecurityAuditEvent): Promise<void>;
  getRecentEvents?(filters?: SecurityAuditQueryFilters): CanonicalSecurityAuditEvent[];
}
