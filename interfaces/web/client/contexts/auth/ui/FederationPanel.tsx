import { useState } from 'react';
import {
  M3AlertBanner,
  M3Button,
  M3JsonViewer,
  M3TextField,
} from '../../../design-system/components/M3Primitives';
import { apiRequest } from '../../../shared/api_client';
import { AuthSession } from '../../identity/domain/types';

export interface FederationPanelProps {
  onFederatedSession: (session: AuthSession) => void;
}

/**
 * Federación de Identidad Externa (Google & Microsoft Entra ID - US-10 & US-11).
 */
export function FederationPanel({ onFederatedSession }: FederationPanelProps) {
  const [provider, setProvider] = useState<'google' | 'microsoft'>('google');
  const [tenantId, setTenantId] = useState('acme-corp');
  const [redirectUri, setRedirectUri] = useState('https://portal.angelpixel.io/callback');
  const [authCode, setAuthCode] = useState('dev_google_jit_2026');
  const [stateToken, setStateToken] = useState('');
  const [result, setResult] = useState<unknown>(null);
  const [traceparent, setTraceparent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleStartLogin = async (selectedProvider: 'google' | 'microsoft') => {
    setProvider(selectedProvider);
    setBusy(true);
    setError(null);
    try {
      const query = new URLSearchParams({
        tenant_id: tenantId,
        redirect_uri: redirectUri,
        format: 'json',
      });
      const res = await apiRequest<{
        url?: string;
        authorizationUrl?: string;
        state?: string;
        error?: string;
        error_description?: string;
      }>(`/api/v1/auth/federation/${selectedProvider}/login?${query.toString()}`);

      setTraceparent(res.trace.traceparent);
      setResult(res.data);

      if (!res.ok) {
        setError(
          res.data?.error_description ??
            res.data?.error ??
            `Error iniciando federación ${selectedProvider}`
        );
        return;
      }

      const targetAuthUrl = res.data?.url ?? res.data?.authorizationUrl;
      if (res.data?.state) {
        setStateToken(res.data.state);
      } else if (targetAuthUrl) {
        try {
          const parsedUrl = new URL(targetAuthUrl);
          const urlState = parsedUrl.searchParams.get('state');
          if (urlState) setStateToken(urlState);
        } catch {
          // Ignore malformed URL
        }
      }
      setAuthCode(
        selectedProvider === 'google' ? 'dev_google_jit_2026' : 'dev_microsoft_jit_2026'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleProcessCallback = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest<{
        accessToken?: string;
        userId?: string;
        email?: string;
        tenantId?: string;
        roles?: string[];
        tokens?: { access_token?: string };
        user?: { id?: string; email?: string; tenantId?: string; roles?: string[] };
        error?: string;
        error_description?: string;
      }>(`/api/v1/auth/federation/${provider}/callback`, {
        method: 'POST',
        body: { code: authCode, state: stateToken },
      });

      setTraceparent(res.trace.traceparent);
      setResult(res.data);

      if (!res.ok) {
        setError(
          res.data?.error_description ??
            res.data?.error ??
            'Error procesando callback federado JIT'
        );
        return;
      }

      const token = res.data?.tokens?.access_token ?? res.data?.accessToken;
      const resolvedUserId = res.data?.user?.id ?? res.data?.userId;
      const resolvedEmail = res.data?.user?.email ?? res.data?.email;
      const resolvedTenantId = res.data?.user?.tenantId ?? res.data?.tenantId ?? tenantId;
      const resolvedRoles = res.data?.user?.roles ?? res.data?.roles;

      if (token && resolvedUserId && resolvedEmail) {
        onFederatedSession({
          token,
          userId: resolvedUserId,
          email: resolvedEmail,
          tenantId: resolvedTenantId,
          roles: resolvedRoles,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="m3-stack">
      <div>
        <h2 className="m3-section-title" style={{ marginBottom: '0.25rem' }}>
          Federación Social &amp; JIT Provisioning (US-10 / US-11)
        </h2>
        <p className="m3-workspace-subtitle">
          Inicia sesión con proveedores externos OIDC y vincula identidades en el inquilino.
        </p>
      </div>

      <div className="m3-grid-2">
        <M3TextField
          id="fed-tenant-id"
          label="Tenant ID"
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
        />
        <M3TextField
          id="fed-redirect-uri"
          label="Redirect URI"
          value={redirectUri}
          onChange={(e) => setRedirectUri(e.target.value)}
        />
      </div>

      <div className="m3-actions-row">
        <M3Button variant="outlined" onClick={() => handleStartLogin('google')} disabled={busy}>
          Continuar con Google
        </M3Button>
        <M3Button variant="outlined" onClick={() => handleStartLogin('microsoft')} disabled={busy}>
          Continuar con Microsoft Entra ID
        </M3Button>
      </div>

      <div className="m3-grid-2">
        <M3TextField
          id="fed-code"
          label="Authorization Code"
          value={authCode}
          onChange={(e) => setAuthCode(e.target.value)}
        />
        <M3TextField
          id="fed-state"
          label="Anti-CSRF State"
          value={stateToken}
          onChange={(e) => setStateToken(e.target.value)}
        />
      </div>

      <div>
        <M3Button
          variant="filled"
          onClick={handleProcessCallback}
          disabled={busy || !stateToken}
        >
          Procesar Callback JIT ({provider})
        </M3Button>
      </div>

      {error && <M3AlertBanner severity="error" title="Error de Federación" message={error} />}

      {result !== null && (
        <M3JsonViewer
          title="Respuesta Federación OIDC"
          badge={traceparent ?? provider}
          data={result}
          testId="federation-output-viewer"
        />
      )}
    </div>
  );
}
