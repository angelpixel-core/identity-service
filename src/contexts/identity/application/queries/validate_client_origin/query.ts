/**
 * Objeto de transferencia inmutable con los parámetros requeridos para validar
 * una aplicación cliente registrada y la concordancia de su origen (CORS / Redirect URI).
 */
export interface ValidateClientOriginQuery {
  readonly clientId?: string;
  readonly origin?: string;
}

