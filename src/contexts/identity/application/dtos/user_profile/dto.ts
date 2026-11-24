/**
 * DTO de salida sanitizado que representa el perfil público y contextual de un usuario dentro de un Tenant.
 * Excluye rigurosamente cualquier atributo sensible como hashes de contraseña.
 */
export interface UserProfileDTO {
  readonly id: string;
  readonly email: string;
  readonly tenantId: string;
  readonly phone?: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

