/**
 * Command DTO: ExchangeAuthorizationCodeCommand
 * Parámetros para el canje de un código de autorización por tokens de acceso e ID (RFC 6749 Sección 4.1.3 & RFC 7636).
 */
export interface ExchangeAuthorizationCodeCommand {
  readonly grantType: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly code: string;
  readonly redirectUri: string;
  readonly codeVerifier?: string;
  readonly ip?: string;
}

