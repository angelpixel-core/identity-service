export interface HttpTransport {
  post: (url: string, data: any, config?: any) => Promise<{ status: number; data: any }>;
}

export interface OAuth2M2MClientConfig {
  baseUrl?: string;
  transport?: HttpTransport;
  refreshBufferSeconds?: number;
}

export interface RequestTokenParams {
  grantType?: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
}

export interface OAuth2TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export interface OAuth2ClientError {
  status: number;
  error: string;
  error_description?: string;
}

interface CachedTokenEntry {
  response: OAuth2TokenResponse;
  expiresAt: number; // ms
}

/**
 * Cliente HTTP/SDK para autenticación Machine-to-Machine (M2M) mediante OAuth2 Client Credentials Grant.
 * Incorpora caché en memoria inteligente con renovación anticipada (buffer de 60 segundos) para mitigar
 * sobrecarga de peticiones redundantes hacia el Identity Provider.
 */
export class OAuth2M2MClient {
  private readonly baseUrl: string;
  private readonly transport: HttpTransport;
  private readonly refreshBufferSeconds: number;
  private readonly tokenCache = new Map<string, CachedTokenEntry>();

  constructor(config: OAuth2M2MClientConfig = {}) {
    this.baseUrl = config.baseUrl?.replace(/\/$/, '') || 'http://localhost:3000';
    this.refreshBufferSeconds = config.refreshBufferSeconds ?? 60;

    this.transport =
      config.transport || {
        post: async (path: string, body: any, customConfig?: any) => {
          const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(customConfig?.headers || {}),
            },
            body: JSON.stringify(body),
          });

          const data = await res.json();

          if (!res.ok) {
            throw {
              status: res.status,
              error: data.error || 'request_failed',
              error_description: data.error_description || 'OAuth2 token request failed',
            };
          }

          return { status: res.status, data };
        },
      };
  }

  /**
   * Obtiene un token de acceso válido desde la caché en memoria si está vigente.
   * Si no existe o está dentro de la ventana de buffer de renovación anticipada (por defecto 60s),
   * solicita un nuevo token al Identity Provider y actualiza la caché.
   */
  public async getValidToken(params: RequestTokenParams): Promise<OAuth2TokenResponse> {
    const cacheKey = this.buildCacheKey(params);
    const cached = this.tokenCache.get(cacheKey);
    const now = Date.now();

    if (cached) {
      const remainingSeconds = (cached.expiresAt - now) / 1000;
      if (remainingSeconds > this.refreshBufferSeconds) {
        return cached.response;
      }
    }

    const tokenResponse = await this.requestToken(params);
    return tokenResponse;
  }

  /**
   * Realiza una petición directa al endpoint de token de OAuth2 (bypaseando caché para refresco forzado)
   * y actualiza la entrada en memoria.
   */
  public async requestToken(params: RequestTokenParams): Promise<OAuth2TokenResponse> {
    const payload = {
      grant_type: params.grantType || 'client_credentials',
      client_id: params.clientId,
      client_secret: params.clientSecret,
      ...(params.scope ? { scope: params.scope } : {}),
    };

    const response = await this.transport.post('/api/v1/oauth2/token', payload, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const tokenResponse = response.data as OAuth2TokenResponse;
    const cacheKey = this.buildCacheKey(params);
    const expiresAt = Date.now() + tokenResponse.expires_in * 1000;

    this.tokenCache.set(cacheKey, {
      response: tokenResponse,
      expiresAt,
    });

    return tokenResponse;
  }

  /**
   * Invalida selectivamente el token en caché para un clientId y scope.
   */
  public invalidateToken(params: Pick<RequestTokenParams, 'clientId' | 'scope'>): void {
    const cacheKey = this.buildCacheKey(params);
    this.tokenCache.delete(cacheKey);
  }

  /**
   * Limpia toda la caché de tokens en memoria.
   */
  public clearTokenCache(): void {
    this.tokenCache.clear();
  }

  private buildCacheKey(params: Pick<RequestTokenParams, 'clientId' | 'scope'>): string {
    return `${params.clientId}:${params.scope || '__all__'}`;
  }
}
