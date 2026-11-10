import { HttpTransport, RequestOptions } from '../types/common';
import {
  RequestTokenParams,
  OAuth2TokenResponse,
  ValidateClientOriginParams,
  ValidateClientOriginResponse,
  BuildAuthorizationUrlParams,
  ExchangeAuthorizationCodeParams,
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
   * Construye de manera segura la URL del endpoint de autorización (/oauth2/authorize).
   */
  public buildAuthorizationUrl(params: BuildAuthorizationUrlParams): string {
    const base = params.baseUrl || '';
    const url = new URL(`${base}/oauth2/authorize`, 'https://identity.local');
    url.searchParams.set('response_type', params.responseType || 'code');
    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);

    if (params.scope) {
      url.searchParams.set('scope', params.scope);
    }
    if (params.state) {
      url.searchParams.set('state', params.state);
    }
    if (params.codeChallenge) {
      url.searchParams.set('code_challenge', params.codeChallenge);
      url.searchParams.set('code_challenge_method', params.codeChallengeMethod || 'S256');
    }
    if (params.nonce) {
      url.searchParams.set('nonce', params.nonce);
    }

    if (params.baseUrl) {
      return url.toString();
    }
    return `${url.pathname}${url.search}`;
  }

  /**
   * Realiza el canje de un AuthorizationCode con PKCE por access_token e id_token (RFC 7636).
   */
  public async exchangeAuthorizationCode(
    params: ExchangeAuthorizationCodeParams,
    options?: RequestOptions
  ): Promise<OAuth2TokenResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    };

    const payload: Record<string, string> = {
      grant_type: 'authorization_code',
      client_id: params.clientId,
      code: params.code,
      redirect_uri: params.redirectUri,
    };

    if (params.codeVerifier) {
      payload.code_verifier = params.codeVerifier;
    }

    if (params.clientSecret) {
      payload.client_secret = params.clientSecret;
    }

    const response = await this.transport.post<OAuth2TokenResponse>(
      '/oauth2/token',
      payload,
      {
        headers,
        timeoutMs: options?.timeoutMs,
      }
    );

    return response.data;
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

