/**
 * Contrato de claims contenidos en los tokens JWT emitidos.
 */
export interface AuthTokenClaims {
  readonly userId: string;
  readonly email?: string;
  readonly tenantId?: string;
  readonly roles?: string[];
  readonly actorType?: 'user' | 'service_agent' | 'platform_operator';
  readonly claims?: Record<string, unknown>;
}

/**
 * Secondary Port (SPI): TokenProviderPort
 * Contrato abstracto para la generación y verificación de tokens de acceso autenticados.
 */
export interface TokenProviderPort {
  generateToken(claims: AuthTokenClaims): Promise<string>;
  verifyToken(token: string): Promise<AuthTokenClaims>;
}

