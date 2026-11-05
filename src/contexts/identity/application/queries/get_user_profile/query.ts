/**
 * Objeto de transferencia inmutable con los parámetros requeridos para consultar el perfil de un usuario.
 */
export interface GetUserProfileQuery {
  readonly userId: string;
  readonly tenantId: string;
}

