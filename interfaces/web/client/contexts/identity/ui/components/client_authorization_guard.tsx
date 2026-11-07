import React, { useState, useEffect, useCallback } from 'react';

export interface ClientValidationResponse {
  authorized: boolean;
  clientId: string;
  clientType: 'confidential' | 'public';
}

export interface ClientValidationError {
  status?: number;
  errorCode?: string;
  message?: string;
}

export interface ClientApiClient {
  validateOrigin: (params: { clientId: string; origin?: string }) => Promise<ClientValidationResponse>;
}

export interface ClientAuthorizationGuardProps {
  clientId: string;
  currentOrigin?: string;
  apiClient?: ClientApiClient;
  children: React.ReactNode;
}

/**
 * ClientAuthorizationGuard
 * Protege vistas o componentes de cliente verificando que el client_id y el origen estén autorizados en el IdP.
 */
export function ClientAuthorizationGuard({
  clientId,
  currentOrigin,
  apiClient,
  children,
}: ClientAuthorizationGuardProps) {
  const [loading, setLoading] = useState<boolean>(true);
  const [authorized, setAuthorized] = useState<boolean>(false);
  const [error, setError] = useState<ClientValidationError | null>(null);

  const defaultApiClient: ClientApiClient = {
    validateOrigin: async ({ clientId: id, origin }) => {
      const targetOrigin = origin || (typeof window !== 'undefined' ? window.location.origin : '');
      const response = await fetch('/api/v1/oauth2/clients/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(targetOrigin ? { Origin: targetOrigin } : {}),
        },
        body: JSON.stringify({ clientId: id }),
      });

      const body = await response.json();
      if (!response.ok) {
        throw {
          status: response.status,
          errorCode: body.error || 'client_authorization_failed',
          message: body.message || 'Client authorization failed',
        };
      }
      return body;
    },
  };

  const client = apiClient ?? defaultApiClient;

  const performValidation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await client.validateOrigin({ clientId, origin: currentOrigin });
      setAuthorized(true);
    } catch (err: any) {
      setAuthorized(false);
      setError({
        status: err?.status,
        errorCode: err?.errorCode || 'client_authorization_error',
        message: err?.message || 'Failed to authorize client application origin',
      });
    } finally {
      setLoading(false);
    }
  }, [client, clientId, currentOrigin]);

  useEffect(() => {
    performValidation();
  }, [performValidation]);

  if (loading) {
    return (
      <div role="status" aria-live="polite" className="client-auth-loading">
        <p>Verifying client authorization and origin...</p>
      </div>
    );
  }

  if (error || !authorized) {
    return (
      <div role="alert" className="client-auth-error" data-testid="client-auth-error">
        <h2>Client Application Access Denied</h2>
        {error?.errorCode && <p className="error-code">Error: {error.errorCode}</p>}
        {error?.message && <p className="error-message">{error.message}</p>}
        <button type="button" onClick={performValidation}>
          Retry Verification
        </button>
      </div>
    );
  }

  return <>{children}</>;
}

