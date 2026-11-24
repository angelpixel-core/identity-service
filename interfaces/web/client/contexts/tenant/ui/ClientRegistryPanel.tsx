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

export interface SafeOAuthClient {
  readonly id: string;
  readonly tenantId?: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly clientType: string;
  readonly clientProfile?: string;
  readonly status?: 'active' | 'suspended';
  readonly allowedOrigins: readonly string[];
  readonly redirectUris: readonly string[];
  readonly allowedGrantTypes: readonly string[];
  readonly scopes: readonly string[];
  readonly isActive: boolean;
  readonly secretGraceExpiresAt?: string | null;
}

interface OneTimeSecretNotice {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly secretGraceExpiresAt?: string | null;
  readonly actionLabel: string;
}

export interface ClientRegistryPanelProps {
  session: AuthSession;
}

/**
 * Dynamic Client Registry, Lifecycle & Secret Rotation (US-03 / US-28).
 */
export function ClientRegistryPanel({ session }: ClientRegistryPanelProps) {
  const [clients, setClients] = useState<readonly SafeOAuthClient[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [secretNotice, setSecretNotice] = useState<OneTimeSecretNotice | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);

  const [newName, setNewName] = useState('');
  const [newProfile, setNewProfile] = useState<'spa' | 'web' | 'native' | 'm2m'>('m2m');
  const [newOrigins, setNewOrigins] = useState('https://app.acme-corp.com');
  const [newRedirectUris, setNewRedirectUris] = useState('');
  const [newScopes, setNewScopes] = useState('identity:read');
  const [creating, setCreating] = useState(false);

  const [bindingsByClient, setBindingsByClient] = useState<
    Record<string, readonly { id: string; tenantId: string; customDomain: string | null; isActive: boolean }[]>
  >({});

  const [validateClientId, setValidateClientId] = useState('portal-web');
  const [validateOrigin, setValidateOrigin] = useState('https://portal.angelpixel.io');
  const [validationResult, setValidationResult] = useState<unknown>(null);
  const [validationTrace, setValidationTrace] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);

  const loadClients = async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await apiRequest<{ clients?: SafeOAuthClient[]; error?: string }>(
        '/api/v1/oauth2/clients',
        {
          token: session.token,
          tenantId: session.tenantId,
        }
      );
      if (!res.ok) {
        setListError(res.data?.error ?? 'No se pudieron cargar los clientes OAuth2');
        return;
      }
      setClients(Array.isArray(res.data?.clients) ? res.data.clients : []);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Error de red cargando clientes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadClients();
  }, [session.token, session.tenantId]);

  const handleRegisterClient = async () => {
    if (!newName.trim()) {
      setListError('El nombre de la aplicación cliente es obligatorio.');
      return;
    }
    setCreating(true);
    setListError(null);
    setSecretNotice(null);
    setCopiedSecret(false);
    try {
      const origins = newOrigins
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const redirects = newRedirectUris
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const scopes = newScopes
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await apiRequest<{
        clientId?: string;
        clientSecret?: string;
        secretGraceExpiresAt?: string | null;
        message?: string;
        error?: string;
      }>('/api/v1/clients', {
        method: 'POST',
        token: session.token,
        tenantId: session.tenantId,
        body: {
          clientName: newName.trim(),
          clientProfile: newProfile,
          allowedOrigins: origins,
          redirectUris: redirects,
          scopes,
        },
      });
      if (!res.ok) {
        setListError(res.data?.message ?? res.data?.error ?? 'No se pudo registrar el cliente');
        return;
      }
      if (res.data?.clientSecret && res.data?.clientId) {
        setSecretNotice({
          clientId: res.data.clientId,
          clientSecret: res.data.clientSecret,
          actionLabel: 'Cliente confidencial registrado (copia única)',
        });
      }
      setNewName('');
      await loadClients();
    } finally {
      setCreating(false);
    }
  };

  const handleToggleStatus = async (client: SafeOAuthClient) => {
    setActionBusyId(client.clientId);
    setListError(null);
    try {
      const nextStatus = client.isActive ? 'suspended' : 'active';
      const res = await apiRequest<{ message?: string; error?: string }>(
        `/api/v1/clients/${encodeURIComponent(client.clientId)}`,
        {
          method: 'PATCH',
          token: session.token,
          tenantId: session.tenantId,
          body: { status: nextStatus },
        }
      );
      if (!res.ok) {
        setListError(res.data?.message ?? res.data?.error ?? 'No se pudo actualizar el estado');
        return;
      }
      await loadClients();
    } finally {
      setActionBusyId(null);
    }
  };

  const handleRotateSecret = async (client: SafeOAuthClient) => {
    setActionBusyId(client.clientId);
    setListError(null);
    setCopiedSecret(false);
    try {
      const res = await apiRequest<{
        clientId?: string;
        clientSecret?: string;
        secretGraceExpiresAt?: string | null;
        message?: string;
        error?: string;
      }>(`/api/v1/clients/${encodeURIComponent(client.clientId)}/rotate-secret`, {
        method: 'POST',
        token: session.token,
        tenantId: session.tenantId,
        body: { gracePeriodSeconds: 300 },
      });
      if (!res.ok) {
        setListError(res.data?.message ?? res.data?.error ?? 'No se pudo rotar el secreto');
        return;
      }
      if (res.data?.clientSecret) {
        setSecretNotice({
          clientId: res.data.clientId ?? client.clientId,
          clientSecret: res.data.clientSecret,
          secretGraceExpiresAt: res.data.secretGraceExpiresAt,
          actionLabel: 'Secreto rotado con ventana de gracia dual (300s)',
        });
      }
      await loadClients();
    } finally {
      setActionBusyId(null);
    }
  };

  const handleCopySecret = async () => {
    if (!secretNotice?.clientSecret || typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(secretNotice.clientSecret);
    setCopiedSecret(true);
  };

  const handleInspectBindings = async (clientId: string) => {
    const res = await apiRequest<{
      bindings?: readonly { id: string; tenantId: string; customDomain: string | null; isActive: boolean }[];
    }>(`/api/v1/clients/${encodeURIComponent(clientId)}/bindings`, {
      token: session.token,
      tenantId: session.tenantId,
    });
    if (res.ok) {
      setBindingsByClient((prev) => ({
        ...prev,
        [clientId]: Array.isArray(res.data?.bindings) ? res.data.bindings : [],
      }));
    }
  };

  const handleValidateOrigin = async () => {
    setValidating(true);
    try {
      const res = await apiRequest('/api/v1/oauth2/clients/validate', {
        method: 'POST',
        body: { clientId: validateClientId, origin: validateOrigin },
      });
      setValidationTrace(res.trace.traceparent);
      setValidationResult({ status: res.status, ...((res.data as object) || {}) });
    } finally {
      setValidating(false);
    }
  };

  return (
    <div className="m3-stack">
      <div className="m3-panel-header">
        <div>
          <h2 className="m3-section-title" style={{ marginBottom: '0.25rem' }}>
            Dynamic Client Registry &amp; CORS (US-03)
          </h2>
          <p className="m3-workspace-subtitle">
            Listado en vivo desde <code>GET /api/v1/oauth2/clients</code> (sin secretos).
          </p>
        </div>
        <M3Button variant="outlined" onClick={loadClients} disabled={loading}>
          {loading ? 'Actualizando...' : 'Recargar Clientes'}
        </M3Button>
      </div>

      {listError && <M3AlertBanner severity="error" title="Error" message={listError} />}

      {secretNotice && (
        <div
          className="m3-card m3-card--tonal"
          style={{ padding: '1rem' }}
          data-testid="client-secret-once-banner"
        >
          <div className="m3-panel-header">
            <div>
              <strong>{secretNotice.actionLabel}</strong>{' '}
              <code>({secretNotice.clientId})</code>
              <p className="m3-workspace-subtitle" style={{ marginTop: '0.25rem' }}>
                Guarda este <code>client_secret</code> ahora; no volverá a mostrarse en claro.
                {secretNotice.secretGraceExpiresAt && (
                  <> Gracia dual hasta {secretNotice.secretGraceExpiresAt}.</>
                )}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <M3Button variant="outlined" onClick={handleCopySecret}>
                {copiedSecret ? 'Copiado' : 'Copiar Secreto'}
              </M3Button>
              <M3Button variant="outlined" onClick={() => setSecretNotice(null)}>
                Ocultar
              </M3Button>
            </div>
          </div>
          <pre
            style={{
              marginTop: '0.6rem',
              padding: '0.5rem 0.75rem',
              borderRadius: 'var(--md-sys-shape-corner-small)',
              background: 'var(--md-sys-color-surface)',
              border: '1px solid var(--md-sys-color-outline-variant)',
              overflowX: 'auto',
              fontFamily: 'var(--md-sys-typescale-font-mono)',
              fontSize: '0.82rem',
            }}
          >
            {secretNotice.clientSecret}
          </pre>
        </div>
      )}

      <details className="m3-lab-details" data-testid="register-client-details">
        <summary>Registrar Nueva Aplicación Cliente (US-28)</summary>
        <div className="m3-stack" style={{ marginTop: '0.75rem' }}>
          <div className="m3-grid-2">
            <M3TextField
              id="new-client-name"
              label="Nombre de Aplicación"
              placeholder="Ej. Billing Worker M2M"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <div className="m3-field">
              <label className="m3-field__label" htmlFor="new-client-profile">
                Perfil de Cliente
              </label>
              <select
                id="new-client-profile"
                className="m3-field__input"
                value={newProfile}
                onChange={(e) =>
                  setNewProfile(e.target.value as 'spa' | 'web' | 'native' | 'm2m')
                }
              >
                <option value="m2m">m2m (Confidencial)</option>
                <option value="web">web (Confidencial)</option>
                <option value="spa">spa (Público PKCE)</option>
                <option value="native">native (Público PKCE)</option>
              </select>
            </div>
          </div>
          <div className="m3-grid-2">
            <M3TextField
              id="new-client-origins"
              label="Allowed Origins (coma)"
              value={newOrigins}
              onChange={(e) => setNewOrigins(e.target.value)}
            />
            <M3TextField
              id="new-client-scopes"
              label="Scopes (espacio)"
              value={newScopes}
              onChange={(e) => setNewScopes(e.target.value)}
            />
          </div>
          <M3TextField
            id="new-client-redirects"
            label="Redirect URIs (opcional, coma)"
            placeholder="https://app.acme-corp.com/callback"
            value={newRedirectUris}
            onChange={(e) => setNewRedirectUris(e.target.value)}
          />
          <div>
            <M3Button
              variant="filled"
              onClick={handleRegisterClient}
              disabled={creating}
              data-testid="register-client-submit"
            >
              {creating ? 'Registrando...' : 'Registrar Cliente'}
            </M3Button>
          </div>
        </div>
      </details>

      <div className="m3-stack" data-testid="client-registry-list">
        {clients.map((client) => {
          const isBusy = actionBusyId === client.clientId;
          const profileLabel = client.clientProfile ?? client.clientType;
          return (
            <div key={client.clientId} className="m3-card m3-card--outlined" style={{ padding: '1rem' }}>
              <div className="m3-panel-header">
                <div>
                  <strong>{client.clientName}</strong>{' '}
                  <code>({client.clientId})</code>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <M3Chip
                    label={
                      client.isActive
                        ? `${profileLabel} · ACTIVE`
                        : `${profileLabel} · SUSPENDED`
                    }
                    tone={client.isActive ? 'primary' : 'neutral'}
                  />
                  <M3Button
                    variant="outlined"
                    onClick={() => handleToggleStatus(client)}
                    disabled={isBusy}
                    data-testid={`toggle-client-${client.clientId}`}
                  >
                    {client.isActive ? 'Suspender' : 'Reactivar'}
                  </M3Button>
                  {client.clientType === 'confidential' && (
                    <M3Button
                      variant="outlined"
                      onClick={() => handleRotateSecret(client)}
                      disabled={isBusy}
                      data-testid={`rotate-secret-${client.clientId}`}
                    >
                      Rotar Secreto
                    </M3Button>
                  )}
                  <M3Button
                    variant="outlined"
                    onClick={() => handleInspectBindings(client.clientId)}
                    data-testid={`view-bindings-${client.clientId}`}
                  >
                    Dominios
                  </M3Button>
                </div>
              </div>
              <p className="m3-workspace-subtitle" style={{ marginTop: '0.35rem' }}>
                Origins: {client.allowedOrigins.join(', ') || '—'} · Scopes: {client.scopes.join(' ')}
              </p>
              {bindingsByClient[client.clientId] && (
                <div
                  className="m3-workspace-subtitle"
                  style={{ marginTop: '0.35rem' }}
                  data-testid={`tenant-bindings-${client.clientId}`}
                >
                  Bindings ({session.tenantId}):{' '}
                  {(bindingsByClient[client.clientId]?.length ?? 0) === 0
                    ? 'Ninguno'
                    : (bindingsByClient[client.clientId] ?? [])
                        .map((b) => `${b.customDomain ?? b.tenantId} (${b.isActive ? 'activo' : 'inactivo'})`)
                        .join(', ')}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="m3-card m3-card--tonal" style={{ padding: '1rem' }}>
        <h3 style={{ fontSize: '0.95rem', marginBottom: '0.75rem' }}>
          Validador en Vivo de Origen CORS
        </h3>
        <div className="m3-grid-2">
          <M3TextField
            id="cors-client-id"
            label="Client ID"
            value={validateClientId}
            onChange={(e) => setValidateClientId(e.target.value)}
          />
          <M3TextField
            id="cors-origin"
            label="Origin"
            value={validateOrigin}
            onChange={(e) => setValidateOrigin(e.target.value)}
          />
        </div>
        <div style={{ marginTop: '0.75rem' }}>
          <M3Button variant="filled" onClick={handleValidateOrigin} disabled={validating}>
            Validar Origen CORS
          </M3Button>
        </div>
      </div>

      {validationResult !== null && (
        <M3JsonViewer
          title="Resultado Validación CORS"
          badge={validationTrace ?? 'CORS'}
          data={validationResult}
          testId="cors-validation-viewer"
        />
      )}
    </div>
  );
}
