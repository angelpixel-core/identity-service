/**
 * Estructura estándar para claves individuales en formato JWK (RFC 7517).
 */
export interface JsonWebKeyDto {
  readonly kty: 'RSA';
  readonly use: 'sig';
  readonly alg: 'RS256';
  readonly kid: string;
  readonly n: string;
  readonly e: string;
}

/**
 * Estructura de respuesta para el conjunto de claves JSON Web Key Set (JWKS - RFC 7517).
 */
export interface JwksResponseDto {
  readonly keys: readonly JsonWebKeyDto[];
}

/**
 * Opciones de firma para tokens asimétricos.
 */
export interface AsymmetricSignOptions {
  readonly expiresIn?: string | number;
  readonly keyId?: string;
}

/**
 * Secondary Port (SPI): AsymmetricKeyProviderPort
 * Abstracción de dominio para la gestión del par de claves asimétricas RSA,
 * exportación de claves públicas en formato JWK / PEM y firma/verificación con RS256.
 */
export interface AsymmetricKeyProviderPort {
  /**
   * Obtiene el identificador (`kid`) de la clave asimétrica activa para firmas.
   */
  getActiveKeyId(): string;

  /**
   * Exporta el conjunto de claves públicas activas en formato estándar JWKS (RFC 7517).
   */
  getPublicKeyJwks(): JwksResponseDto;

  /**
   * Retorna la clave pública en formato PEM estándar (SPKI).
   */
  getPublicKeyPem(kid?: string): string;

  /**
   * Firma un payload arbitrario generando un token JWT con algoritmo RS256 y cabecera `kid`.
   */
  signToken(payload: Record<string, unknown>, options?: AsymmetricSignOptions): Promise<string>;

  /**
   * Verifica la firma y vigencia de un token RS256 utilizando la clave pública correspondiente.
   */
  verifyToken<T = any>(token: string): Promise<T>;
}
