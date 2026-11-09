import { ClientConfig, DEFAULT_CONFIG, createDefaultTransport } from './config';
import { HttpTransport } from './types/common';
import { TokenManager } from './auth';
import { AuthResource } from './resources/auth_resource';
import { UsersResource } from './resources/users_resource';
import { OAuth2Resource } from './resources/oauth2_resource';
import { DiscoveryResource } from './resources/discovery_resource';
import { RequestTokenParams, OAuth2TokenResponse } from './types/oauth2';

/**
 * Cliente principal del SDK de AngelPixel Identity Service.
 * Expone recursos organizados por dominio: `auth`, `users`, `oauth2`, `discovery`.
 */
export class IdentityServiceClient {
  public readonly auth: AuthResource;
  public readonly users: UsersResource;
  public readonly oauth2: OAuth2Resource;
  public readonly discovery: DiscoveryResource;
  public readonly transport: HttpTransport;
  public readonly tokenManager: TokenManager;

  constructor(config: ClientConfig = {}) {
    const baseUrl = config.baseUrl?.replace(/\/$/, '') || DEFAULT_CONFIG.baseUrl;

    this.transport = config.transport || createDefaultTransport(baseUrl, config.defaultHeaders);

    this.tokenManager = new TokenManager({
      transport: this.transport,
      refreshBufferSeconds: config.refreshBufferSeconds ?? DEFAULT_CONFIG.refreshBufferSeconds,
    });

    this.auth = new AuthResource(this.transport);
    this.users = new UsersResource(this.transport);
    this.oauth2 = new OAuth2Resource(this.transport, this.tokenManager);
    this.discovery = new DiscoveryResource(this.transport);
  }

  // ---------------------------------------------------------------------------
  // Métodos de conveniencia directa para retrocompatibilidad total con OAuth2M2MClient
  // ---------------------------------------------------------------------------

  public async getValidToken(params: RequestTokenParams): Promise<OAuth2TokenResponse> {
    return this.oauth2.getValidToken(params);
  }

  public async requestToken(params: RequestTokenParams): Promise<OAuth2TokenResponse> {
    return this.oauth2.requestToken(params);
  }

  public invalidateToken(params: Pick<RequestTokenParams, 'clientId' | 'scope'>): void {
    this.oauth2.invalidateToken(params);
  }

  public clearTokenCache(): void {
    this.oauth2.clearTokenCache();
  }
}

/**
 * Alias de retrocompatibilidad directa para consumidores existentes de OAuth2M2MClient.
 */
export class OAuth2M2MClient extends IdentityServiceClient {}

