import { HttpTransport, RequestOptions } from '../types/common';
import { OpenIdConfiguration, JwksResponse } from '../types/discovery';

/**
 * Resource para interactuar con los endpoints de descubrimiento OIDC y JWKS.
 */
export class DiscoveryResource {
  constructor(private readonly transport: HttpTransport) {}

  /**
   * Obtiene los metadatos de configuración de OpenID Connect Discovery 1.0 (RFC 8414).
   * Endpoint: GET /.well-known/openid-configuration
   */
  public async getOpenIdConfiguration(
    options?: RequestOptions
  ): Promise<OpenIdConfiguration> {
    if (!this.transport.get) {
      throw new Error('El transporte HTTP actual no implementa el método GET');
    }

    const response = await this.transport.get<OpenIdConfiguration>(
      '/.well-known/openid-configuration',
      options
    );
    return response.data;
  }

  /**
   * Obtiene el conjunto de claves públicas criptográficas en formato JWKS (RFC 7517).
   * Endpoint: GET /.well-known/jwks.json
   */
  public async getJwks(options?: RequestOptions): Promise<JwksResponse> {
    if (!this.transport.get) {
      throw new Error('El transporte HTTP actual no implementa el método GET');
    }

    const response = await this.transport.get<JwksResponse>(
      '/.well-known/jwks.json',
      options
    );
    return response.data;
  }
}
