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

export interface DynamicFederatedProviderSummary {
  readonly id: string;
  readonly displayName: string;
  readonly protocol: 'oidc' | 'oauth2';
}

export interface FederationPanelProps {
  onFederatedSession: (session: AuthSession) => void;
  federatedProviders?: readonly DynamicFederatedProviderSummary[];
  defaultTenantId?: string;
}

interface FederatedCallbackResult {
  readonly accessToken?: string;
  readonly userId?: string;
  readonly email?: string;
  readonly tenantId?: string;
  readonly roles?: string[];
  readonly isNewUser?: boolean;
  readonly linked?: boolean;
  readonly tokens?: { readonly access_token?: string };
  readonly user?: {
    readonly id?: string;
    readonly email?: string;
    readonly tenantId?: string;
    readonly roles?: string[];
  };
  readonly userProfile?: {
    readonly provider?: 'google' | 'microsoft';
    readonly externalSubjectId?: string;
    readonly email?: string;
    readonly emailVerified?: boolean;
    readonly name?: string;
    readonly picture?: string;
  };
  readonly statePayload?: {
    readonly tenantId?: string;
    readonly provider?: 'google' | 'microsoft';
  };
  readonly error?: string;
  readonly error_description?: string;
}

const DEFAULT_DEV_REDIRECT_URI = 'https://portal.angelpixel.io/callback';

function buildLiveRedirectUri(selectedProvider: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  return `${origin}/api/v1/auth/federation/${selectedProvider}/callback`;
}

/**
 * Federación de Identidad Externa (Google, Microsoft Entra ID & IdPs por Tenant - US-10, US-11, US-34).
 */
export function FederationPanel({
  onFederatedSession,
  federatedProviders,
  defaultTenantId = 'acme-corp',
}: FederationPanelProps) {
  const [provider, setProvider] = useState<string>('google');
  const [tenantId, setTenantId] = useState(defaultTenantId);
  const [redirectUri, setRedirectUri] = useState(DEFAULT_DEV_REDIRECT_URI);
  const [authCode, setAuthCode] = useState('dev_google_jit_2026');
  const [stateToken, setStateToken] = useState('');
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [traceparent, setTraceparent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [providerStatus, setProviderStatus] = useState<FederationStatusPayload | null>(null);
  const [showUseCaseInfo, setShowUseCaseInfo] = useState(false);

  const applyFederatedPayload = (payload: FederatedCallbackResult) => {
    setResult(payload);
    setError(null);
    const token = payload.tokens?.access_token ?? payload.accessToken;
    const resolvedUserId = payload.user?.id ?? payload.userId;
    const resolvedEmail = payload.user?.email ?? payload.email;
    const resolvedTenantId =
      payload.user?.tenantId ?? payload.tenantId ?? payload.statePayload?.tenantId ?? tenantId;
    const resolvedRoles = payload.user?.roles ?? payload.roles;

    if (token && resolvedUserId && resolvedEmail) {
      onFederatedSession({
        token,
        userId: resolvedUserId,
        email: resolvedEmail,
        tenantId: resolvedTenantId,
        roles: resolvedRoles,
        name: payload.userProfile?.name,
        picture: payload.userProfile?.picture,
        provider: payload.userProfile?.provider ?? payload.statePayload?.provider ?? provider,
      });
    }
  };

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

    try {
      const stored = window.sessionStorage.getItem('identity_federation_last_result');
      if (stored) {
        window.sessionStorage.removeItem('identity_federation_last_result');
        const parsed = JSON.parse(stored) as FederatedCallbackResult;
        applyFederatedPayload(parsed);
      }
    } catch {
      // Ignore invalid sessionStorage payload
    }

    const handleMessage = (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.data?.type === 'identity-service:federation-callback' &&
        event.data?.payload
      ) {
        applyFederatedPayload(event.data.payload as FederatedCallbackResult);
      }
    };
    window.addEventListener('message', handleMessage);

    return () => {
      active = false;
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  const handleStartLogin = async (selectedProvider: string) => {
    setProvider(selectedProvider);
    setBusy(true);
    setError(null);
    setAuthorizationUrl(null);
    try {
      const statusMap = providerStatus?.providers as Record<string, ProviderStatusEntry> | undefined;
      const isLive = Boolean(statusMap?.[selectedProvider]?.configured);
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

  const handleOpenLiveLogin = () => {
    if (!authorizationUrl) return;
    const popup = window.open(authorizationUrl, 'oidc-federation-login', 'width=540,height=680');
    if (!popup) {
      window.location.assign(authorizationUrl);
    }
  };

  const handleProcessCallback = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest<FederatedCallbackResult>(
        `/api/v1/auth/federation/${provider}/callback`,
        {
          method: 'POST',
          body: { code: authCode, state: stateToken },
        }
      );

      setTraceparent(res.trace.traceparent);

      if (!res.ok) {
        setResult(res.data);
        setError(
          res.data?.error_description ??
            res.data?.error ??
            'Error procesando callback federado JIT'
        );
        return;
      }

      if (res.data) {
        applyFederatedPayload(res.data);
      }
    } finally {
      setBusy(false);
    }
  };

  const federatedResult =
    result && typeof result === 'object' ? (result as FederatedCallbackResult) : null;
  const activeProfile = federatedResult?.userProfile;
  const allLiveConfigured = Boolean(
    providerStatus?.providers.google.configured && providerStatus?.providers.microsoft.configured
  );

  return (
    <div className="m3-stack">
      <div>
        <div className="m3-title-with-info">
          <h2 className="m3-section-title" style={{ marginBottom: 0 }}>
            Federación Social &amp; JIT Provisioning
          </h2>
          <button
            type="button"
            className="m3-info-btn"
            aria-label="Información de casos de uso"
            aria-expanded={showUseCaseInfo}
            title={'US-10: Login OIDC Externo\nUS-11: Account Linking & JIT Provisioning'}
            onClick={() => setShowUseCaseInfo((prev) => !prev)}
          >
            i
          </button>
        </div>
        <p className="m3-workspace-subtitle">
          Inicia sesión con proveedores externos OIDC y vincula identidades en el inquilino.
        </p>
        {showUseCaseInfo && (
          <div className="m3-info-popover" role="note">
            <strong>US-10:</strong> Inicio de sesión OIDC externo (Google / Microsoft) y validación
            Anti-CSRF (<code>state</code> / <code>nonce</code>).
            <br />
            <strong>US-11:</strong> Vinculación automática de cuentas (Account Linking) y
            aprovisionamiento Just-In-Time (JIT).
          </div>
        )}
      </div>

      {providerStatus && (
        <div className="m3-stack" data-testid="federation-provider-status">
          <div className="m3-status-table" role="table" aria-label="Estado de proveedores OIDC">
            <div className="m3-status-row" role="row">
              <span className="m3-status-label" role="cell">
                Google OIDC
              </span>
              <span
                className={`m3-status-dot ${providerStatus.providers.google.configured ? 'm3-status-dot--live' : 'm3-status-dot--offline'}`}
                role="cell"
                data-testid="federation-status-google"
                title={
                  providerStatus.providers.google.configured
                    ? 'Configurado (Live)'
                    : 'Emulador Dev (sin GOOGLE_CLIENT_ID)'
                }
                aria-label={
                  providerStatus.providers.google.configured
                    ? 'Google OIDC: Configurado (Live)'
                    : 'Google OIDC: Emulador Dev (sin GOOGLE_CLIENT_ID)'
                }
              />
            </div>
            <div className="m3-status-row" role="row">
              <span className="m3-status-label" role="cell">
                Microsoft Entra ID
              </span>
              <span
                className={`m3-status-dot ${providerStatus.providers.microsoft.configured ? 'm3-status-dot--live' : 'm3-status-dot--offline'}`}
                role="cell"
                data-testid="federation-status-microsoft"
                title={
                  providerStatus.providers.microsoft.configured
                    ? 'Configurado (Live)'
                    : 'Emulador Dev (sin MICROSOFT_CLIENT_ID)'
                }
                aria-label={
                  providerStatus.providers.microsoft.configured
                    ? 'Microsoft Entra ID: Configurado (Live)'
                    : 'Microsoft Entra ID: Emulador Dev (sin MICROSOFT_CLIENT_ID)'
                }
              />
            </div>
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

      <M3TextField
        id="fed-tenant-id"
        label="Tenant ID"
        value={tenantId}
        onChange={(e) => setTenantId(e.target.value)}
      />

      <div className="m3-actions-row">
        {federatedProviders && federatedProviders.length > 0 ? (
          federatedProviders.map((item) => (
            <M3Button
              key={item.id}
              variant="outlined"
              onClick={() => handleStartLogin(item.id)}
              disabled={busy}
              data-testid={`fed-login-${item.id}`}
            >
              Continuar con {item.displayName}
            </M3Button>
          ))
        ) : (
          <>
            <M3Button variant="outlined" onClick={() => handleStartLogin('google')} disabled={busy}>
              Continuar con Google
            </M3Button>
            <M3Button variant="outlined" onClick={() => handleStartLogin('microsoft')} disabled={busy}>
              Continuar con Microsoft Entra ID
            </M3Button>
          </>
        )}
      </div>

      {authorizationUrl &&
        (providerStatus?.providers as Record<string, ProviderStatusEntry> | undefined)?.[provider]
          ?.configured && (
        <div className="m3-stack" style={{ gap: '0.5rem' }}>
          <M3AlertBanner
            severity="info"
            title={`Autorización OIDC Live (${provider === 'google' ? 'Google' : 'Microsoft Entra ID'})`}
            message={`Abre la URL oficial del proveedor para autenticarte y recibir el código real en ${redirectUri}.`}
          />
          <div className="m3-actions-row">
            <M3Button
              variant="tonal"
              onClick={handleOpenLiveLogin}
              disabled={busy}
              data-testid="federation-live-auth-link"
            >
              Abrir Login en {provider === 'google' ? 'Google' : 'Microsoft Entra ID'}
            </M3Button>
          </div>
        </div>
      )}

      <details className="m3-lab-details" open={!allLiveConfigured}>
        <summary>Laboratorio OIDC / Callback Manual</summary>
        <div className="m3-stack" style={{ marginTop: '0.75rem' }}>
          <M3TextField
            id="fed-redirect-uri"
            label="Redirect URI"
            value={redirectUri}
            onChange={(e) => setRedirectUri(e.target.value)}
          />
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
        </div>
      </details>

      {error && <M3AlertBanner severity="error" title="Error de Federación" message={error} />}

      {activeProfile && (
        <div
          className="m3-card m3-stack"
          data-testid="federated-identity-card"
          style={{ padding: '1rem', borderRadius: '16px', gap: '0.75rem' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
            {activeProfile.picture ? (
              <img
                src={activeProfile.picture}
                alt={activeProfile.name || activeProfile.email || 'Federated avatar'}
                referrerPolicy="no-referrer"
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '999px',
                  objectFit: 'cover',
                }}
              />
            ) : (
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '999px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 600,
                  background: 'var(--md-sys-color-primary-container, #d3e3fd)',
                  color: 'var(--md-sys-color-on-primary-container, #041e49)',
                }}
              >
                {(activeProfile.name || activeProfile.email || 'U').slice(0, 1).toUpperCase()}
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '1rem' }}>
                {activeProfile.name || activeProfile.email}
              </div>
              <div className="m3-workspace-subtitle" style={{ margin: 0 }}>
                {activeProfile.email}
              </div>
            </div>
          </div>

          <div className="m3-chip-row">
            <M3Chip
              label={
                activeProfile.provider === 'microsoft' ? 'Microsoft Entra ID' : 'Google OIDC'
              }
              tone="primary"
            />
            <M3Chip
              label={activeProfile.emailVerified ? 'Correo Verificado' : 'Correo No Verificado'}
              tone={activeProfile.emailVerified ? 'success' : 'warning'}
            />
            <M3Chip
              label={`Tenant: ${
                federatedResult?.user?.tenantId ??
                federatedResult?.statePayload?.tenantId ??
                tenantId
              }`}
              tone="neutral"
            />
            {typeof federatedResult?.isNewUser === 'boolean' && (
              <M3Chip
                label={
                  federatedResult.isNewUser
                    ? 'Aprovisionamiento JIT (Nuevo Usuario)'
                    : federatedResult.linked
                      ? 'Account Linking (Vinculado)'
                      : 'Identidad Federada Existente'
                }
                tone="success"
              />
            )}
          </div>
        </div>
      )}

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
