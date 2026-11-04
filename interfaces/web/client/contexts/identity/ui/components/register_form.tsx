import { useState, FormEvent, ChangeEvent } from 'react';
import { AuthApiClient, DefaultAuthApiClient } from '../../data/api';
import { AuthSession } from '../../domain/types';

export interface RegisterFormProps {
  readonly apiClient?: AuthApiClient;
  readonly onSuccess?: (session: AuthSession) => void;
  readonly defaultTenantId?: string;
}

/**
 * Componente de interfaz de usuario: Formulario de Registro de Usuario Multitenant.
 */
export function RegisterForm({
  apiClient = new DefaultAuthApiClient(),
  onSuccess,
  defaultTenantId = '',
}: RegisterFormProps) {
  const [tenantId, setTenantId] = useState<string>(defaultTenantId);
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setValidationError(null);
    setServerError(null);

    if (password.length < 8) {
      setValidationError('Password must be at least 8 characters long');
      return;
    }

    setIsLoading(true);
    try {
      const session = await apiClient.register({
        tenantId,
        email,
        password,
      });
      if (onSuccess) {
        onSuccess(session);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setServerError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div>
        <label htmlFor="tenant-input">Tenant ID</label>
        <input
          id="tenant-input"
          type="text"
          value={tenantId}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setTenantId(e.target.value)}
          required
        />
      </div>

      <div>
        <label htmlFor="email-input">Email</label>
        <input
          id="email-input"
          type="email"
          value={email}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
          required
        />
      </div>

      <div>
        <label htmlFor="password-input">Password</label>
        <input
          id="password-input"
          type="password"
          value={password}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
          required
        />
      </div>

      {validationError && (
        <div role="alert" style={{ color: 'red' }}>
          {validationError}
        </div>
      )}

      {serverError && (
        <div role="alert" style={{ color: 'red' }}>
          {serverError}
        </div>
      )}

      <button type="submit" disabled={isLoading}>
        {isLoading ? 'Creating account...' : 'Create Account'}
      </button>
    </form>
  );
}

