import { HttpTransport, HttpResponse, RequestOptions } from './types/common';
import { parseHttpError } from './errors';

export interface ClientConfig {
  baseUrl?: string;
  transport?: HttpTransport;
  timeoutMs?: number;
  refreshBufferSeconds?: number;
  defaultHeaders?: Record<string, string>;
}

export const DEFAULT_CONFIG = {
  baseUrl: 'http://localhost:4000',
  timeoutMs: 10000,
  refreshBufferSeconds: 60,
} as const;

export function createDefaultTransport(baseUrl: string, defaultHeaders: Record<string, string> = {}): HttpTransport {
  const sanitizeUrl = (path: string): string => {
    const cleanBase = baseUrl.replace(/\/$/, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${cleanBase}${cleanPath}`;
  };

  const request = async <T = any>(
    method: string,
    path: string,
    body?: any,
    options?: RequestOptions
  ): Promise<HttpResponse<T>> => {
    const url = sanitizeUrl(path);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...defaultHeaders,
      ...(options?.headers || {}),
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options?.timeoutMs ?? DEFAULT_CONFIG.timeoutMs);

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const contentType = res.headers.get('content-type') || '';
      let data: any = null;
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        data = await res.text();
      }

      if (!res.ok) {
        throw parseHttpError(res.status, data);
      }

      return {
        status: res.status,
        data,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  return {
    get: <T = any>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
    post: <T = any>(path: string, body?: any, options?: RequestOptions) => request<T>('POST', path, body, options),
    put: <T = any>(path: string, body?: any, options?: RequestOptions) => request<T>('PUT', path, body, options),
    delete: <T = any>(path: string, options?: RequestOptions) => request<T>('DELETE', path, undefined, options),
  };
}

