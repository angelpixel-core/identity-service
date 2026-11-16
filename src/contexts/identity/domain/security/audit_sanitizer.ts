/**
 * Domain Service: AuditSanitizer
 * Ofuscación profunda y sanitización recursiva de datos confidenciales y secretos.
 * Cumplimiento normativo: PCI-DSS v4.0 (Req 3.4 & 10.5) y SOC 2 Type II (CC7.2).
 */

const BENIGN_EXCLUSIONS = [/status[_-]?code/i, /zip[_-]?code/i, /country[_-]?code/i];

const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  /pass(?:word)?/i,
  /secret/i,
  /token/i,
  /(?:^|_|-|auth(?:orization)?)code/i, // 'code', 'auth_code', 'authorizationCode'
  /private[_-]?key/i,
  /api[_-]?key/i,
  /(?:^|_|-)pan(?:$|_|-)/i,
  /card[_-]?number/i,
  /cvv|cvc/i,
  /pin/i,
  /ssn/i,
];

// Heurísticas de regex para patrones embebidos en texto plano
const JWT_REGEX = /(?:Bearer\s+)?eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g;
const PEM_PRIVATE_KEY_REGEX = /-----BEGIN[ A-Z0-9_-]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z0-9_-]*PRIVATE KEY-----/g;
const PAN_REGEX = /\b(?:\d{4}[ -]?){3}\d{4}\b|\b\d{15,16}\b/g;
const KV_SECRET_REGEX = /((?:password|pass|secret|token|client_secret|api_key|private_key)\s*[:=]\s*)([^\s&,;]+)/gi;

export const REDACTED_VALUE = '[REDACTED]';

/**
 * Determina si el nombre de una clave corresponde a un dato confidencial.
 */
export function isSensitiveKey(key: string): boolean {
  if (BENIGN_EXCLUSIONS.some((pattern) => pattern.test(key))) {
    return false;
  }
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Escanea una cadena de texto y reemplaza patrones sensibles (JWT, PEMs de claves privadas, PANs, credenciales en URLs/query).
 */
export function sanitizeString(value: string): string {
  let result = value;
  result = result.replace(PEM_PRIVATE_KEY_REGEX, REDACTED_VALUE);
  result = result.replace(JWT_REGEX, REDACTED_VALUE);
  result = result.replace(PAN_REGEX, REDACTED_VALUE);
  result = result.replace(KV_SECRET_REGEX, `$1${REDACTED_VALUE}`);
  return result;
}

/**
 * Sanitiza recursivamente cualquier valor u objeto, protegiendo contra ciclos y preservando inmutabilidad.
 */
export function sanitizeAuditValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message),
      stack: value.stack ? sanitizeString(value.stack) : undefined,
    };
  }

  if (seen.has(value)) {
    return '[CIRCULAR]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditValue(item, seen));
  }

  const sanitizedObj: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (isSensitiveKey(k)) {
      sanitizedObj[k] = REDACTED_VALUE;
    } else {
      sanitizedObj[k] = sanitizeAuditValue(v, seen);
    }
  }

  return sanitizedObj;
}

/**
 * Sanitiza un diccionario de detalles de auditoría para su registro seguro.
 */
export function sanitizeAuditDetails(details?: Record<string, unknown>): Record<string, unknown> {
  if (!details || typeof details !== 'object') {
    return {};
  }
  return sanitizeAuditValue(details) as Record<string, unknown>;
}
