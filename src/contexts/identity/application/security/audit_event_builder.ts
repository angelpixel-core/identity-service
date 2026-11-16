import {
  SecurityAuditEvent,
  CanonicalSecurityAuditEvent,
  SecurityAuditSeverity,
  SecurityAuditStatus,
} from '../ports/security/audit_logger';
import { sanitizeAuditDetails } from '../../domain/security/audit_sanitizer';

/**
 * Mapeo canónico de eventos legacy en snake_case a tipos bancarios en mayúsculas.
 */
const EVENT_TYPE_MAP: Record<string, string> = {
  client_authenticated: 'AUTH_LOGIN_SUCCESS',
  client_authentication_failed: 'AUTH_LOGIN_FAILURE',
  cross_tenant_violation: 'CROSS_TENANT_VIOLATION',
  code_reuse_violation: 'CODE_REUSE_VIOLATION',
  pkce_verification_failed: 'PKCE_VERIFICATION_FAILED',
  refresh_token_reuse_detected: 'REFRESH_TOKEN_REUSE_DETECTED',
  federation_callback_processed: 'FEDERATION_CALLBACK_PROCESSED',
  federation_callback_failed: 'FEDERATION_CALLBACK_FAILED',
  secret_rotation_success: 'SECRET_ROTATION_SUCCESS',
  secret_rotation_failure: 'SECRET_ROTATION_FAILURE',
};

/**
 * Mapeo de requerimientos PCI-DSS v4.0 por tipo de evento de seguridad.
 * - 10.2.1: Acceso / Autenticación de usuarios y aplicaciones.
 * - 10.2.5: Verificación de mecanismos de identificación y autorización (tokens, tenants, códigos).
 * - 10.2.6: Inicialización de bitácoras de auditoría y ciclo de vida de claves criptográficas.
 */
const DEFAULT_PCI_MAP: Record<string, string> = {
  AUTH_LOGIN_SUCCESS: '10.2.1',
  AUTH_LOGIN_FAILURE: '10.2.1',
  TOKEN_ISSUED: '10.2.5',
  TOKEN_REVOKED: '10.2.5',
  REFRESH_ROTATED: '10.2.5',
  CROSS_TENANT_VIOLATION: '10.2.5',
  CLIENT_ORIGIN_DENIED: '10.2.5',
  CODE_REUSE_VIOLATION: '10.2.5',
  PKCE_VERIFICATION_FAILED: '10.2.5',
  REFRESH_TOKEN_REUSE_DETECTED: '10.2.5',
  FEDERATION_CALLBACK_PROCESSED: '10.2.1',
  FEDERATION_CALLBACK_FAILED: '10.2.1',
  SECRET_ROTATION_SUCCESS: '10.2.6',
  SECRET_ROTATION_FAILURE: '10.2.6',
};

/**
 * Application Service: buildCanonicalAuditEvent
 * Transforma un evento de auditoría en un CanonicalSecurityAuditEvent enriquecido,
 * inmutable y completamente conforme con PCI-DSS v4.0 Req 10.2/10.5 y SOC 2 CC7.2.
 */
export function buildCanonicalAuditEvent(raw: SecurityAuditEvent): CanonicalSecurityAuditEvent {
  const canonicalEventType = EVENT_TYPE_MAP[raw.eventType] ?? raw.eventType;

  // 1. Severidad inferida
  let severity: SecurityAuditSeverity = raw.severity ?? 'INFO';
  if (!raw.severity) {
    if (canonicalEventType === 'CROSS_TENANT_VIOLATION') {
      severity = 'ALERT';
    } else if (
      canonicalEventType.endsWith('_FAILURE') ||
      canonicalEventType.includes('VIOLATION') ||
      canonicalEventType.includes('DENIED') ||
      canonicalEventType.includes('REUSE') ||
      canonicalEventType.includes('FAILED')
    ) {
      severity = 'WARN';
    }
  }

  // 2. Estado inferido
  let status: SecurityAuditStatus = raw.status ?? 'SUCCESS';
  if (!raw.status) {
    if (canonicalEventType.includes('DENIED') || canonicalEventType === 'CROSS_TENANT_VIOLATION') {
      status = 'DENIED';
    } else if (
      canonicalEventType.endsWith('_FAILURE') ||
      canonicalEventType.includes('VIOLATION') ||
      canonicalEventType.includes('REUSE') ||
      canonicalEventType.includes('FAILED')
    ) {
      status = 'FAILURE';
    }
  }

  // 3. Actor unificado
  const actor = Object.freeze({
    userId: raw.actor?.userId ?? raw.clientId,
    type: raw.actor?.type ?? (raw.clientId ? 'CLIENT' : 'SYSTEM'),
    ip: raw.actor?.ip ?? raw.ip,
  });

  // 4. Traza
  const trace = Object.freeze({
    requestId: raw.trace?.requestId,
    correlationId: raw.trace?.correlationId,
  });

  // 5. Cumplimiento
  const compliance = Object.freeze({
    pciRequirement: raw.compliance?.pciRequirement ?? DEFAULT_PCI_MAP[canonicalEventType] ?? '10.2.1',
    soc2Criteria: raw.compliance?.soc2Criteria ?? 'CC7.2',
    retentionCategory: raw.compliance?.retentionCategory ?? 'AUDIT_IMMUTABLE',
  });

  // 6. Fusión de detalles y sanitización profunda
  const mergedDetails = {
    ...(raw.reason ? { reason: raw.reason } : {}),
    ...(raw.metadata ?? {}),
    ...(raw.details ?? {}),
  };
  const sanitizedDetails = Object.freeze(sanitizeAuditDetails(mergedDetails));

  return Object.freeze({
    timestamp: raw.timestamp ? raw.timestamp.toISOString() : new Date().toISOString(),
    logType: 'SECURITY_AUDIT',
    eventType: canonicalEventType,
    severity,
    tenantId: raw.tenantId,
    actor,
    trace,
    compliance,
    action: raw.action ?? canonicalEventType.toLowerCase(),
    status,
    details: sanitizedDetails,
  });
}
