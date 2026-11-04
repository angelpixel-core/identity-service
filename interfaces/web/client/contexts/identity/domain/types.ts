/**
 * Tipos inmutables de dominio para el contexto de Identidad en el cliente Web.
 */
export interface RegisterCredentials {
  readonly tenantId: string;
  readonly email: string;
  readonly password: string;
}

export interface AuthSession {
  readonly token: string;
  readonly userId: string;
  readonly email: string;
  readonly tenantId: string;
}

export interface UserProfile {
  readonly userId: string;
  readonly email: string;
  readonly tenantId: string;
}
