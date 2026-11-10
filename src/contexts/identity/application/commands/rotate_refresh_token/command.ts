/**
 * Command DTO: RotateRefreshTokenCommand
 * Parámetros para la rotación de un Refresh Token y renovación de sesión (RFC 6749 Sección 6 & US-09).
 */
export interface RotateRefreshTokenCommand {
  readonly refreshToken: string;
  readonly clientId?: string;
  readonly ip?: string;
  readonly userAgent?: string;
}

