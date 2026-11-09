import { HttpTransport, RequestOptions } from '../types/common';
import { RegisterUserParams, RegisterUserResponse } from '../types/auth';

export class AuthResource {
  constructor(private readonly transport: HttpTransport) {}

  /**
   * Registra un nuevo usuario bajo un tenant específico.
   * Envía la cabecera multi-tenant requerida `x-tenant-id`.
   */
  public async register(
    params: RegisterUserParams,
    options?: RequestOptions
  ): Promise<RegisterUserResponse> {
    const { tenantId, email, password, name, roles } = params;

    const response = await this.transport.post<RegisterUserResponse>(
      '/api/v1/auth/register',
      { email, password, name, roles },
      {
        headers: {
          'x-tenant-id': tenantId,
          ...(options?.headers || {}),
        },
        timeoutMs: options?.timeoutMs,
      }
    );

    return response.data;
  }
}

