import { HttpTransport, RequestOptions } from '../types/common';
import { GetUserProfileParams, GetUserByIdParams, UserProfile } from '../types/users';

export class UsersResource {
  constructor(private readonly transport: HttpTransport) {}

  /**
   * Obtiene el perfil del usuario autenticado bajo su contexto de tenant.
   * Requiere token Bearer JWT y cabecera `x-tenant-id`.
   */
  public async getProfile(
    params: GetUserProfileParams,
    options?: RequestOptions
  ): Promise<UserProfile> {
    const { token, tenantId } = params;

    if (!this.transport.get) {
      throw new Error('El transporte HTTP actual no implementa el método GET');
    }

    const response = await this.transport.get<UserProfile>('/api/v1/auth/me', {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-tenant-id': tenantId,
        ...(options?.headers || {}),
      },
      timeoutMs: options?.timeoutMs,
    });

    return response.data;
  }

  /**
   * Obtiene un perfil de usuario por ID dentro del contexto del tenant activo (US-06).
   * Si el usuario pertenece a otro tenant, el servidor responderá con 404 Not Found.
   */
  public async getUserById(
    params: GetUserByIdParams,
    options?: RequestOptions
  ): Promise<UserProfile> {
    const { userId, token, tenantId } = params;

    if (!this.transport.get) {
      throw new Error('El transporte HTTP actual no implementa el método GET');
    }

    const response = await this.transport.get<UserProfile>(`/api/v1/users/${encodeURIComponent(userId)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-tenant-id': tenantId,
        ...(options?.headers || {}),
      },
      timeoutMs: options?.timeoutMs,
    });

    return response.data;
  }
}

