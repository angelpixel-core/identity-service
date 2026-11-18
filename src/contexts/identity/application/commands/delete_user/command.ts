/**
 * DTO Inmutable: DeleteUserCommand
 * Transporta los identificadores requeridos para la eliminación física de un usuario.
 */
export interface DeleteUserCommand {
  readonly userId: string;
  readonly tenantId: string;
}
