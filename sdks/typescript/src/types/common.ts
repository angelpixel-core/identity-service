/**
 * Abstracción de transporte HTTP para desacoplar el SDK del entorno de ejecución (Node.js fetch, Axios o Mock).
 */
export interface HttpResponse<T = any> {
  status: number;
  data: T;
  headers?: Record<string, string>;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface HttpTransport {
  get?: <T = any>(path: string, options?: RequestOptions) => Promise<HttpResponse<T>>;
  post: <T = any>(path: string, body?: any, options?: RequestOptions) => Promise<HttpResponse<T>>;
  put?: <T = any>(path: string, body?: any, options?: RequestOptions) => Promise<HttpResponse<T>>;
  delete?: <T = any>(path: string, options?: RequestOptions) => Promise<HttpResponse<T>>;
}

