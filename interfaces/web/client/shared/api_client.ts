export interface ApiTraceMetadata {
  readonly traceparent: string | null;
  readonly requestId: string | null;
  readonly correlationId: string | null;
}

export interface ApiRequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly token?: string;
  readonly tenantId?: string;
  readonly traceparent?: string;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

export interface ApiResponse<T = unknown> {
  readonly ok: boolean;
  readonly status: number;
  readonly data: T;
  readonly trace: ApiTraceMetadata;
  readonly latencyMs: number;
}

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

/**
 * Adaptador HTTP compartido para las superficies /auth, /tenant y /platform (US-23 & US-20).
 * Inyecta X-Request-ID y extrae traceparent / X-Request-ID / X-Correlation-ID de respuesta.
 */
export async function apiRequest<T = unknown>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<ApiResponse<T>> {
  const method = options.method ?? 'GET';
  const requestId = options.requestId ?? generateRequestId();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Request-ID': requestId,
    ...(options.headers ?? {}),
  };

  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }
  if (options.tenantId) {
    headers['X-Tenant-ID'] = options.tenantId;
  }
  if (options.traceparent) {
    headers['traceparent'] = options.traceparent;
  }
  if (options.correlationId) {
    headers['X-Correlation-ID'] = options.correlationId;
  }

  let bodyPayload: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    bodyPayload = JSON.stringify(options.body);
  }

  const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const response = await fetch(path, {
    method,
    headers,
    body: bodyPayload,
  });
  const end = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const contentType = response.headers.get('content-type') || '';
  const data = (
    contentType.includes('application/json')
      ? await response.json()
      : await response.text()
  ) as T;

  return {
    ok: response.ok,
    status: response.status,
    data,
    trace: {
      traceparent: response.headers.get('traceparent'),
      requestId: response.headers.get('x-request-id'),
      correlationId: response.headers.get('x-correlation-id'),
    },
    latencyMs: Math.max(0, Math.round(end - start)),
  };
}
