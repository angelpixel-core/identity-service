/**
 * Command: RegisterUserCommand
 * DTO inmutable de entrada que transporta los parámetros requeridos para la mutación
 * de registro de un usuario dentro de un tenant específico.
 */
export interface RegisterUserCommand {
  readonly tenantId: string;
  readonly email: string;
  readonly password: string;
  readonly roles?: string[];
  readonly phone?: string | null;
}

