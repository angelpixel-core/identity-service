import { GetOpenIdConfigurationQuery } from './query';

export interface OpenIdConfigurationDto {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
  readonly userinfo_endpoint: string;
  readonly response_types_supported: readonly string[];
  readonly subject_types_supported: readonly string[];
  readonly id_token_signing_alg_values_supported: readonly string[];
  readonly scopes_supported: readonly string[];
  readonly token_endpoint_auth_methods_supported: readonly string[];
  readonly claims_supported: readonly string[];
  readonly code_challenge_methods_supported: readonly string[];
  readonly grant_types_supported: readonly string[];
}

/**
 * Caso de Uso (Read Slice): Obtención de metadatos de configuración OpenID Connect (RFC 8414 & OIDC Core 1.0).
 */
export class GetOpenIdConfigurationQueryHandler {
  constructor(private readonly defaultIssuer: string = 'http://localhost:4000') {}

  public execute(query?: GetOpenIdConfigurationQuery): OpenIdConfigurationDto {
    const rawBaseUrl = query?.issuerBaseUrl || this.defaultIssuer;
    // Normalizar eliminando barra inclinada final
    const baseUrl = rawBaseUrl.endsWith('/') ? rawBaseUrl.slice(0, -1) : rawBaseUrl;

    return {
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth2/authorize`,
      token_endpoint: `${baseUrl}/api/v1/oauth2/token`,
      jwks_uri: `${baseUrl}/.well-known/jwks.json`,
      userinfo_endpoint: `${baseUrl}/api/v1/auth/me`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      scopes_supported: ['openid', 'profile', 'email', 'identity:read', 'identity:write'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
      claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'email', 'tenantId'],
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code', 'client_credentials', 'refresh_token'],
    };
  }
}
