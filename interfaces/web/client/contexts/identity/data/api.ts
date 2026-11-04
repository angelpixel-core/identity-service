import { AuthSession, RegisterCredentials } from '../domain/types';

/**
 * Puerto secundario en frontend: AuthApiClient
 * Desacopla los componentes visuales de la implementación HTTP subyacente.
 */
export interface AuthApiClient {
  register(credentials: RegisterCredentials): Promise<AuthSession>;
}

/**
 * Adaptador de infraestructura web basado en Fetch API.
 */
export class DefaultAuthApiClient implements AuthApiClient {
  constructor(private readonly baseUrl: string = '/api/v1') {}

  public async register(credentials: RegisterCredentials): Promise<AuthSession> {
    const response = await fetch(`${this.baseUrl}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': credentials.tenantId,
      },
      body: JSON.stringify({
        email: credentials.email,
        password: credentials.password,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to register account');
    }

    return data;
  }
}

