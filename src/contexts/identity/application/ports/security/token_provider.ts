/**
 * Contrato de claims contenidos en los tokens JWT emitidos.
 */
export interface AuthTokenClaims {
  readonly userId: string;
  readonly email: string;
  readonly tenantId: string;
}

/**
 * Secondary Port (SPI): TokenProviderPort
 * Contrato abstracto para la generación y verificación de tokens de acceso autenticados.
 */
export interface TokenProviderPort {
  generateToken(claims: AuthTokenClaims): Promise<string>;
  verifyToken(token: string): Promise<AuthTokenClaims>;
}

