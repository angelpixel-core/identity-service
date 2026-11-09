/**
 * Estructura estándar de clave pública en formato JWK (RFC 7517).
 */
export interface JsonWebKey {
  readonly kty: string;
  readonly use: string;
  readonly alg: string;
  readonly kid: string;
  readonly n: string;
  readonly e: string;
  readonly [key: string]: unknown;
}

/**
 * Estructura de respuesta para el conjunto de claves JSON Web Key Set (JWKS - RFC 7517).
 */
export interface JwksResponse {
  readonly keys: readonly JsonWebKey[];
}

/**
 * Metadatos de configuración OpenID Connect Discovery 1.0 (RFC 8414 & OIDC Core 1.0).
 */
export interface OpenIdConfiguration {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
  readonly userinfo_endpoint?: string;
  readonly response_types_supported: readonly string[];
  readonly subject_types_supported: readonly string[];
  readonly id_token_signing_alg_values_supported: readonly string[];
  readonly scopes_supported?: readonly string[];
  readonly token_endpoint_auth_methods_supported?: readonly string[];
  readonly claims_supported?: readonly string[];
  readonly code_challenge_methods_supported?: readonly string[];
  readonly grant_types_supported?: readonly string[];
  readonly [key: string]: unknown;
}
