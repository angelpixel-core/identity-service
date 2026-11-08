import { HttpTransport, RequestOptions } from '../types/common';
import {
  RequestTokenParams,
  OAuth2TokenResponse,
  ValidateClientOriginParams,
  ValidateClientOriginResponse,
} from '../types/oauth2';
import { TokenManager } from '../auth';

export class OAuth2Resource {
  constructor(
    private readonly transport: HttpTransport,
    private readonly tokenManager: TokenManager
  ) {}

  /**
   * Valida un origen cliente contra el registro de aplicaciones autorizadas.
   */
  public async validateOrigin(
    params: ValidateClientOriginParams,
    options?: RequestOptions
  ): Promise<ValidateClientOriginResponse> {
    const headers: Record<string, string> = {
      ...(options?.headers || {}),
    };

    if (params.origin) {
      headers['Origin'] = params.origin;
    }

    const response = await this.transport.post<ValidateClientOriginResponse>(
      '/api/v1/oauth2/clients/validate',
      { clientId: params.clientId },
      {
        headers,
        timeoutMs: options?.timeoutMs,
      }
    );

    return response.data;
  }

  /**
   * Obtiene un token M2M utilizando Smart Caching en memoria y refresco proactivo.
   */
  public async getValidToken(
    params: RequestTokenParams,
    options?: RequestOptions
  ): Promise<OAuth2TokenResponse> {
    return this.tokenManager.getValidToken(params, options);
  }

  /**
   * Solicita un nuevo token M2M directamente al servidor, forzando la renovación de caché.
   */
  public async requestToken(
    params: RequestTokenParams,
    options?: RequestOptions
  ): Promise<OAuth2TokenResponse> {
    return this.tokenManager.requestToken(params, options);
  }

  /**
   * Invalida el token en caché para un cliente y scope dados.
   */
  public invalidateToken(params: Pick<RequestTokenParams, 'clientId' | 'scope'>): void {
    this.tokenManager.invalidateToken(params);
  }

  /**
   * Limpia toda la caché de tokens en memoria.
   */
  public clearTokenCache(): void {
    this.tokenManager.clearTokenCache();
  }
}

