/**
 * Tipos inmutables de dominio para el contexto de Identidad en el cliente Web.
 */
export interface RegisterCredentials {
  readonly tenantId: string;
  readonly email: string;
  readonly password: string;
  readonly phone?: string;
}

export interface LoginCredentials {
  readonly tenantId: string;
  readonly email: string;
  readonly password: string;
}

export interface AuthSession {
  readonly token: string;
  readonly userId: string;
  readonly email: string;
  readonly tenantId: string;
  readonly roles?: readonly string[];
  readonly phone?: string | null;
  readonly name?: string;
  readonly picture?: string;
  readonly provider?: string;
}

export interface UserProfile {
  readonly id?: string;
  readonly userId?: string;
  readonly email: string;
  readonly tenantId: string;
  readonly roles?: readonly string[];
  readonly phone?: string | null;
  readonly name?: string;
  readonly picture?: string;
  readonly provider?: string;
  readonly createdAt?: Date | string;
  readonly updatedAt?: Date | string;
}


