import { useState, FormEvent, ChangeEvent } from 'react';
import { AuthApiClient, DefaultAuthApiClient } from '../../data/api';
import { AuthSession } from '../../domain/types';
import { apiRequest } from '../../../../shared/api_client';

export interface LoginFormProps {
  readonly apiClient?: AuthApiClient;
  readonly onSuccess?: (session: AuthSession) => void;
  readonly defaultTenantId?: string;
  readonly disabled?: boolean;
  readonly passkeysEnabled?: boolean;
  readonly clientId?: string;
}

function base64urlToUint8Array(base64url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

function bufferToBase64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Formulario de inicio de sesión con email/contraseña y Passkey WebAuthn (US-32 / US-36).
 */
export function LoginForm({
  apiClient = new DefaultAuthApiClient(),
  onSuccess,
  defaultTenantId = '',
  disabled = false,
  passkeysEnabled = false,
  clientId,
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

  const handlePasskeyLogin = async () => {
    setError(null);
    if (typeof navigator === 'undefined' || !navigator.credentials?.get) {
      setError('WebAuthn / Passkeys no está soportado en este navegador.');
      return;
    }

    setIsLoading(true);
    try {
      const optRes = await apiRequest<Record<string, any> & { message?: string; error?: string }>(
        '/api/v1/auth/passkeys/login/options',
        {
          method: 'POST',
          tenantId,
          body: {
            ...(email.trim() ? { email: email.trim() } : {}),
            ...(clientId ? { clientId } : {}),
          },
        }
      );

      if (!optRes.ok) {
        setError(optRes.data?.message ?? optRes.data?.error ?? 'No se pudo iniciar login con Passkey');
        return;
      }

      const opts = optRes.data;
      const publicKey: PublicKeyCredentialRequestOptions = {
        ...opts,
        challenge: base64urlToUint8Array(String(opts.challenge)) as unknown as BufferSource,
        allowCredentials: Array.isArray(opts.allowCredentials)
          ? opts.allowCredentials.map((cred: any) => ({
              ...cred,
              id: base64urlToUint8Array(String(cred.id)) as unknown as BufferSource,
            }))
          : [],
      };

      const assertion = (await navigator.credentials.get({
        publicKey,
      })) as PublicKeyCredential | null;

      if (!assertion) {
        setError('Autenticación con Passkey cancelada.');
        return;
      }

      const authResponse = assertion.response as AuthenticatorAssertionResponse;
      const verifyPayload = {
        id: assertion.id,
        rawId: bufferToBase64url(assertion.rawId),
        type: assertion.type,
        response: {
          authenticatorData: bufferToBase64url(authResponse.authenticatorData),
          clientDataJSON: bufferToBase64url(authResponse.clientDataJSON),
          signature: bufferToBase64url(authResponse.signature),
          ...(authResponse.userHandle
            ? { userHandle: bufferToBase64url(authResponse.userHandle) }
            : {}),
        },
        clientExtensionResults: assertion.getClientExtensionResults?.() ?? {},
      };

      const verifyRes = await apiRequest<AuthSession & { message?: string; error?: string }>(
        '/api/v1/auth/passkeys/login/verify',
        {
          method: 'POST',
          tenantId,
          body: {
            ...(clientId ? { clientId } : {}),
            challenge: String(opts.challenge),
            response: verifyPayload,
          },
        }
      );

      if (!verifyRes.ok) {
        setError(verifyRes.data?.message ?? verifyRes.data?.error ?? 'Fallo al verificar Passkey');
        return;
      }

      onSuccess?.(verifyRes.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error autenticando con Passkey');
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

      {!disabled && (
        <div>
          <label htmlFor="login-password-input">Password</label>
          <input
            id="login-password-input"
            type="password"
            value={password}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            required
          />
        </div>
      )}

      {error && (
        <div role="alert" style={{ color: 'red' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
        {!disabled && (
          <button type="submit" disabled={isLoading} data-testid="login-submit-btn">
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
        )}

        {passkeysEnabled && (
          <button
            type="button"
            disabled={isLoading}
            onClick={handlePasskeyLogin}
            data-testid="passkey-login-btn"
          >
            Iniciar sesión con Passkey
          </button>
        )}
      </div>
    </form>
  );
}
