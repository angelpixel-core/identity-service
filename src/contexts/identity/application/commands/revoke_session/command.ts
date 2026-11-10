/**
 * Command DTO: RevokeSessionCommand
 * Parámetros para la revocación explícita de sesión / Refresh Token (RFC 7009 & US-09).
 */
export interface RevokeSessionCommand {
  readonly refreshToken: string;
  readonly ip?: string;
  readonly reason?: string;
}

