/**
 * Comando inmutable para autenticar un cliente confidencial M2M y emitir un Access Token (RFC 6749 Sección 4.4).
 */
export interface AuthenticateClientM2MCommand {
  readonly grantType: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly scope?: string;
  readonly ip?: string;
}

