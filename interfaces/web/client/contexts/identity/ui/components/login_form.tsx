import { useState, FormEvent, ChangeEvent } from 'react';
import { AuthApiClient, DefaultAuthApiClient } from '../../data/api';
import { AuthSession } from '../../domain/types';

export interface LoginFormProps {
  readonly apiClient?: AuthApiClient;
  readonly onSuccess?: (session: AuthSession) => void;
  readonly defaultTenantId?: string;
  readonly disabled?: boolean;
}

/**
 * Formulario de inicio de sesión con email y contraseña (US-32).
 */
export function LoginForm({
  apiClient = new DefaultAuthApiClient(),
  onSuccess,
  defaultTenantId = '',
  disabled = false,
}: LoginFormProps) {
  const [tenantId, setTenantId] = useState<string>(defaultTenantId);
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (disabled || !apiClient.login) return;
    setError(null);

    if (!email.trim() || !password) {
      setError('Email and password are required');
      return;
    }

    setIsLoading(true);
    try {
      const session = await apiClient.login({ tenantId, email, password });
      onSuccess?.(session);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to sign in');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate data-testid="login-form">
      <div>
        <label htmlFor="login-tenant-input">Tenant ID</label>
        <input
          id="login-tenant-input"
          type="text"
          value={tenantId}
          disabled={disabled}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setTenantId(e.target.value)}
          required
        />
      </div>

      <div>
        <label htmlFor="login-email-input">Email</label>
        <input
          id="login-email-input"
          type="email"
          value={email}
          disabled={disabled}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
          required
        />
      </div>

      <div>
        <label htmlFor="login-password-input">Password</label>
        <input
          id="login-password-input"
          type="password"
          value={password}
          disabled={disabled}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
          required
        />
      </div>

      {error && (
        <div role="alert" style={{ color: 'red' }}>
          {error}
        </div>
      )}

      <button type="submit" disabled={isLoading || disabled} data-testid="login-submit-btn">
        {isLoading ? 'Signing in...' : 'Sign In'}
      </button>
    </form>
  );
}
