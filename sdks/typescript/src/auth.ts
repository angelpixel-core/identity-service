import { HttpTransport, RequestOptions } from './types/common';
import { RequestTokenParams, OAuth2TokenResponse } from './types/oauth2';

export interface CachedTokenEntry {
  response: OAuth2TokenResponse;
  expiresAt: number; // timestamp en ms
}

export interface TokenManagerConfig {
  transport: HttpTransport;
  refreshBufferSeconds?: number;
  tokenEndpoint?: string;
}

/**
 * Gestor de tokens OAuth2 con Smart In-Memory Caching y renovación anticipada preventiva.
 * Evita la sobrecarga de solicitudes idénticas hacia el Identity Provider y garantiza
 * tokens siempre válidos para workers y microservicios M2M.
 */
export class TokenManager {
  private readonly transport: HttpTransport;
  private readonly refreshBufferSeconds: number;
  private readonly tokenEndpoint: string;
  private readonly tokenCache = new Map<string, CachedTokenEntry>();

  constructor(config: TokenManagerConfig) {
    this.transport = config.transport;
    this.refreshBufferSeconds = config.refreshBufferSeconds ?? 60;
    this.tokenEndpoint = config.tokenEndpoint ?? '/api/v1/oauth2/token';
  }

  /**
   * Obtiene un token válido. Si existe en caché y restan más segundos que el buffer de renovación,
   * se retorna inmediatamente (Cache Hit). De lo contrario, solicita un nuevo token (Cache Miss/Expired).
   */
  public async getValidToken(
    params: RequestTokenParams,
    options?: RequestOptions
  ): Promise<OAuth2TokenResponse> {
    const cacheKey = this.buildCacheKey(params);
    const cached = this.tokenCache.get(cacheKey);
    const now = Date.now();

    if (cached) {
      const remainingSeconds = (cached.expiresAt - now) / 1000;
      if (remainingSeconds > this.refreshBufferSeconds) {
        return cached.response;
      }
    }

    return this.requestToken(params, options);
  }

  /**
   * Realiza una solicitud directa al endpoint de emisión de tokens OAuth2 (bypaseando la caché),
   * y guarda el resultado en caché.
   */
  public async requestToken(
    params: RequestTokenParams,
    options?: RequestOptions
  ): Promise<OAuth2TokenResponse> {
    const payload = {
      grant_type: params.grantType || 'client_credentials',
      client_id: params.clientId,
      client_secret: params.clientSecret,
      ...(params.scope ? { scope: params.scope } : {}),
    };

    const response = await this.transport.post<OAuth2TokenResponse>(this.tokenEndpoint, payload, {
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      },
      timeoutMs: options?.timeoutMs,
    });

    const tokenResponse = response.data;
    const cacheKey = this.buildCacheKey(params);
    const expiresAt = Date.now() + tokenResponse.expires_in * 1000;

    this.tokenCache.set(cacheKey, {
      response: tokenResponse,
      expiresAt,
    });

    return tokenResponse;
  }

  /**
   * Invalida el token en caché para un clientId y scope específicos.
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

  /**
   * Retorna una clave única de caché para un cliente y scope.
   */
  public buildCacheKey(params: Pick<RequestTokenParams, 'clientId' | 'scope'>): string {
    return `${params.clientId}:${params.scope || '__all__'}`;
  }
}

