import { useEffect, useState } from 'react';
import {
  M3AlertBanner,
  M3Button,
  M3Chip,
  M3JsonViewer,
  M3TextField,
} from '../../../design-system/components/M3Primitives';
import { apiRequest } from '../../../shared/api_client';
import { AuthSession } from '../../identity/domain/types';

interface ProviderStatusEntry {
  readonly configured: boolean;
  readonly mode: 'live' | 'dev_emulator';
  readonly envVar: string;
}

interface FederationStatusPayload {
  readonly environment: string;
  readonly providers: {
    readonly google: ProviderStatusEntry;
    readonly microsoft: ProviderStatusEntry;
  };
}

export interface FederationPanelProps {
  onFederatedSession: (session: AuthSession) => void;
}

const DEFAULT_DEV_REDIRECT_URI = 'https://portal.angelpixel.io/callback';

function buildLiveRedirectUri(selectedProvider: 'google' | 'microsoft'): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  return `${origin}/api/v1/auth/federation/${selectedProvider}/callback`;
}

/**
 * Federación de Identidad Externa (Google & Microsoft Entra ID - US-10 & US-11).
 */
export function FederationPanel({ onFederatedSession }: FederationPanelProps) {
  const [provider, setProvider] = useState<'google' | 'microsoft'>('google');
  const [tenantId, setTenantId] = useState('acme-corp');
  const [redirectUri, setRedirectUri] = useState(DEFAULT_DEV_REDIRECT_URI);
  const [authCode, setAuthCode] = useState('dev_google_jit_2026');
  const [stateToken, setStateToken] = useState('');
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [traceparent, setTraceparent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [providerStatus, setProviderStatus] = useState<FederationStatusPayload | null>(null);

  useEffect(() => {
    let active = true;
    void apiRequest<FederationStatusPayload>('/api/v1/auth/federation/status').then((res) => {
      if (active && res.ok && res.data?.providers) {
        setProviderStatus(res.data);
        if (res.data.providers.google.configured) {
          setRedirectUri(buildLiveRedirectUri('google'));
          setAuthCode('');
        }
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const handleStartLogin = async (selectedProvider: 'google' | 'microsoft') => {
    setProvider(selectedProvider);
    setBusy(true);
    setError(null);
    setAuthorizationUrl(null);
    try {
      const isLive = Boolean(providerStatus?.providers[selectedProvider]?.configured);
      const effectiveRedirectUri =
        isLive &&
        (redirectUri === DEFAULT_DEV_REDIRECT_URI ||
          redirectUri.includes('/api/v1/auth/federation/'))
          ? buildLiveRedirectUri(selectedProvider)
          : redirectUri;
      if (effectiveRedirectUri !== redirectUri) {
        setRedirectUri(effectiveRedirectUri);
      }

      const query = new URLSearchParams({
        tenant_id: tenantId,
        redirect_uri: effectiveRedirectUri,
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
      setAuthorizationUrl(targetAuthUrl ?? null);
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
        isLive
          ? ''
          : selectedProvider === 'google'
            ? 'dev_google_jit_2026'
            : 'dev_microsoft_jit_2026'
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

      {providerStatus && (
        <div className="m3-stack" data-testid="federation-provider-status">
          <div className="m3-chip-row">
            <M3Chip
              label={
                providerStatus.providers.google.configured
                  ? 'Google OIDC: Configurado (Live)'
                  : 'Google OIDC: Emulador Dev (sin GOOGLE_CLIENT_ID)'
              }
              tone={providerStatus.providers.google.configured ? 'success' : 'warning'}
            />
            <M3Chip
              label={
                providerStatus.providers.microsoft.configured
                  ? 'Microsoft Entra ID: Configurado (Live)'
                  : 'Microsoft Entra ID: Emulador Dev (sin MICROSOFT_CLIENT_ID)'
              }
              tone={providerStatus.providers.microsoft.configured ? 'success' : 'warning'}
            />
          </div>
          {(!providerStatus.providers.google.configured ||
            !providerStatus.providers.microsoft.configured) && (
            <M3AlertBanner
              severity="info"
              title="Modo Emulador Dev Local"
              message="No hay credenciales OIDC reales configuradas en .env; el backend usa el emulador local con códigos dev_google_jit_2026 / dev_microsoft_jit_2026."
            />
          )}
        </div>
      )}

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

      {authorizationUrl && providerStatus?.providers[provider]?.configured && (
        <div className="m3-stack" style={{ gap: '0.5rem' }}>
          <M3AlertBanner
            severity="info"
            title={`Autorización OIDC Live (${provider === 'google' ? 'Google' : 'Microsoft Entra ID'})`}
            message={`Abre la URL oficial del proveedor para autenticarte y recibir el código real en ${redirectUri}.`}
          />
          <div className="m3-actions-row">
            <a
              href={authorizationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="m3-button m3-button--tonal"
              data-testid="federation-live-auth-link"
            >
              Abrir Login en {provider === 'google' ? 'Google' : 'Microsoft Entra ID'}
            </a>
          </div>
        </div>
      )}

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
