import { useState, FormEvent, ChangeEvent } from 'react';
import { AuthApiClient, DefaultAuthApiClient } from '../../data/api';
import { AuthSession } from '../../domain/types';

const E164_REGEX = /^\+[1-9]\d{6,14}$/;

export interface RegisterFormProps {
  readonly apiClient?: AuthApiClient;
  readonly onSuccess?: (session: AuthSession) => void;
  readonly defaultTenantId?: string;
  readonly requirePhone?: boolean;
  readonly kycRequired?: boolean;
  readonly kycMinLevel?: string;
  readonly disabled?: boolean;
}

/**
 * Componente de interfaz de usuario: Formulario de Registro de Usuario Multitenant (US-01 / US-32).
 */
export function RegisterForm({
  apiClient = new DefaultAuthApiClient(),
  onSuccess,
  defaultTenantId = '',
  requirePhone = false,
  kycRequired = false,
  kycMinLevel = 'basic',
  disabled = false,
}: RegisterFormProps) {
  const [tenantId, setTenantId] = useState<string>(defaultTenantId);
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (disabled) return;
    setValidationError(null);
    setServerError(null);

    if (password.length < 8) {
      setValidationError('Password must be at least 8 characters long');
      return;
    }

    const normalizedPhone = phone.trim().replace(/[\s\-().]/g, '');
    if (requirePhone) {
      if (!normalizedPhone || !E164_REGEX.test(normalizedPhone)) {
        setValidationError('Phone number must be in international E.164 format (e.g. +5491112345678)');
        return;
      }
    }

    setIsLoading(true);
    try {
      const session = await apiClient.register({
        tenantId,
        email,
        password,
        ...(normalizedPhone ? { phone: normalizedPhone } : {}),
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
      {kycRequired && (
        <div
          role="status"
          data-testid="register-kyc-notice"
          className="m3-banner m3-banner--info"
          style={{ marginBottom: '0.75rem' }}
        >
          <span>
            Este tenant requiere verificación KYC ({kycMinLevel}) durante el onboarding.
          </span>
        </div>
      )}

      <div>
        <label htmlFor="tenant-input">Tenant ID</label>
        <input
          id="tenant-input"
          type="text"
          value={tenantId}
          disabled={disabled}
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
          disabled={disabled}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
          required
        />
      </div>

      {requirePhone && (
        <div>
          <label htmlFor="phone-input">Teléfono (E.164)</label>
          <input
            id="phone-input"
            data-testid="register-phone-input"
            type="tel"
            placeholder="+5491112345678"
            value={phone}
            disabled={disabled}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)}
            required
          />
        </div>
      )}

      <div>
        <label htmlFor="password-input">Password</label>
        <input
          id="password-input"
          type="password"
          value={password}
          disabled={disabled}
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

      <button type="submit" disabled={isLoading || disabled}>
        {isLoading ? 'Creating account...' : 'Create Account'}
      </button>
    </form>
  );
}
