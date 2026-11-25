import { useEffect, useState } from 'react';
import {
  M3AlertBanner,
  M3Button,
  M3Chip,
  M3TextField,
} from '../../../design-system/components/M3Primitives';
import { apiRequest } from '../../../shared/api_client';
import { AuthSession } from '../../identity/domain/types';

export interface SafeTenantFederatedProviderItem {
  readonly id: string;
  readonly tenantId: string;
  readonly providerKey: string;
  readonly displayName: string;
  readonly protocol: 'oidc' | 'oauth2';
  readonly issuerUrl: string;
  readonly clientId: string;
  readonly hasClientSecret: boolean;
  readonly scopes: readonly string[];
  readonly enabled: boolean;
}

export interface TenantFederatedProvidersPanelProps {
  readonly session: AuthSession;
  readonly allowTenantSwitch?: boolean;
}

/**
 * Panel M3 de Proveedores Federados por Tenant (US-33).
 * Reutilizado en /tenant (scoped) y /platform (cross-tenant para system:superadmin).
 */
export function TenantFederatedProvidersPanel({
  session,
  allowTenantSwitch = false,
}: TenantFederatedProvidersPanelProps) {
  const [targetTenantId, setTargetTenantId] = useState(
    allowTenantSwitch ? 'acme-corp' : session.tenantId
  );
  const [providers, setProviders] = useState<readonly SafeTenantFederatedProviderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [providerKey, setProviderKey] = useState('okta-corp');
  const [displayName, setDisplayName] = useState('Okta Corporate');
  const [protocol, setProtocol] = useState<'oidc' | 'oauth2'>('oidc');
  const [issuerUrl, setIssuerUrl] = useState('https://acme.okta.com/oauth2/default');
  const [clientId, setClientId] = useState('okta-b2b-client-01');
  const [clientSecret, setClientSecret] = useState('');
  const [scopesText, setScopesText] = useState('openid email profile');

  const canManage =
    allowTenantSwitch ||
    Boolean(
      session.roles?.some(
        (role) => role === 'tenant_admin' || role === 'admin' || role === 'system:superadmin'
      )
    );

  const loadProviders = async (tenantToLoad = targetTenantId) => {
    const normalized = tenantToLoad.trim() || session.tenantId;
    setLoading(true);
    setError(null);
    const res = await apiRequest<{
      providers?: readonly SafeTenantFederatedProviderItem[];
      message?: string;
      error?: string;
    }>(`/api/v1/tenants/${encodeURIComponent(normalized)}/federation/providers`, {
      token: session.token,
      tenantId: session.tenantId,
    });
    setLoading(false);
    if (!res.ok) {
      setError(res.data?.message || res.data?.error || `HTTP ${res.status}`);
      return;
    }
    setProviders(Array.isArray(res.data?.providers) ? res.data.providers : []);
  };

  useEffect(() => {
    void loadProviders(targetTenantId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.token, session.tenantId]);

  const handleRegister = async () => {
    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);
    const normalized = targetTenantId.trim() || session.tenantId;
    const scopes = scopesText
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const res = await apiRequest<
      SafeTenantFederatedProviderItem & { message?: string; error?: string }
    >(`/api/v1/tenants/${encodeURIComponent(normalized)}/federation/providers`, {
      method: 'POST',
      token: session.token,
      tenantId: session.tenantId,
      body: {
        providerKey: providerKey.trim(),
        displayName: displayName.trim(),
        protocol,
        issuerUrl: issuerUrl.trim(),
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim() || undefined,
        scopes,
      },
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.data?.message || res.data?.error || `HTTP ${res.status}`);
      return;
    }
    setClientSecret('');
    setSuccessMsg(`Proveedor "${res.data.providerKey}" guardado con secreto cifrado AES-256-GCM.`);
    await loadProviders(normalized);
  };

  const handleRemove = async (key: string) => {
    setError(null);
    setSuccessMsg(null);
    const normalized = targetTenantId.trim() || session.tenantId;
    const res = await apiRequest<{ message?: string; error?: string }>(
      `/api/v1/tenants/${encodeURIComponent(normalized)}/federation/providers/${encodeURIComponent(key)}`,
      {
        method: 'DELETE',
        token: session.token,
        tenantId: session.tenantId,
      }
    );
    if (!res.ok) {
      setError(res.data?.message || res.data?.error || `HTTP ${res.status}`);
      return;
    }
    setSuccessMsg(`Proveedor "${key}" eliminado de ${normalized}.`);
    await loadProviders(normalized);
  };

  return (
    <div className="m3-stack" data-testid="tenant-federated-providers-panel">
      <div className="m3-panel-header">
        <div>
          <h2 className="m3-section-title" style={{ marginBottom: '0.25rem' }}>
            Proveedores Federados (IdP) por Tenant (US-33)
          </h2>
          <p className="m3-workspace-subtitle">
            Registro aislado por RLS de proveedores OIDC/OAuth2 (Okta, LinkedIn, Slack) con{' '}
            <code>client_secret</code> cifrado AES-256-GCM.
          </p>
        </div>
        <M3Button variant="outlined" onClick={() => loadProviders(targetTenantId)} disabled={loading}>
          {loading ? 'Cargando...' : 'Actualizar IdPs'}
        </M3Button>
      </div>

      {allowTenantSwitch && (
        <div style={{ maxWidth: '360px' }}>
          <M3TextField
            id="idp-target-tenant"
            label="Tenant Objetivo"
            value={targetTenantId}
            onChange={(e) => setTargetTenantId(e.target.value)}
          />
        </div>
      )}

      {!canManage && (
        <M3AlertBanner
          severity="info"
          title="Modo solo lectura"
          message="Solo tenant_admin o system:superadmin pueden registrar o eliminar proveedores federados."
          testId="idp-readonly-banner"
        />
      )}

      {error && (
        <M3AlertBanner
          severity="error"
          title="Error en Proveedores IdP"
          message={error}
          testId="idp-error-banner"
        />
      )}

      {successMsg && (
        <M3AlertBanner
          severity="success"
          title="Operación IdP Completada"
          message={successMsg}
          testId="idp-success-banner"
        />
      )}

      {canManage && (
        <div className="m3-card m3-card--tonal" style={{ padding: '1rem' }}>
          <h3 style={{ fontSize: '0.95rem', marginBottom: '0.75rem' }}>
            Registrar / Actualizar Proveedor IdP
          </h3>
          <div className="m3-grid-2">
            <M3TextField
              id="idp-provider-key"
              label="Provider Key (slug)"
              value={providerKey}
              onChange={(e) => setProviderKey(e.target.value)}
            />
            <M3TextField
              id="idp-display-name"
              label="Nombre Visible"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <div className="m3-field">
              <label className="m3-field__label" htmlFor="idp-protocol">
                Protocolo
              </label>
              <select
                id="idp-protocol"
                className="m3-field__input"
                value={protocol}
                onChange={(e) => setProtocol(e.target.value as 'oidc' | 'oauth2')}
              >
                <option value="oidc">oidc (OpenID Connect)</option>
                <option value="oauth2">oauth2 (OAuth 2.0)</option>
              </select>
            </div>
            <M3TextField
              id="idp-issuer-url"
              label="Issuer URL (HTTPS)"
              value={issuerUrl}
              onChange={(e) => setIssuerUrl(e.target.value)}
            />
            <M3TextField
              id="idp-client-id"
              label="Client ID"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            />
            <M3TextField
              id="idp-client-secret"
              label="Client Secret"
              type="password"
              placeholder="Cifrado AES-256-GCM en reposo"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
            />
          </div>
          <div style={{ marginTop: '0.75rem' }}>
            <M3TextField
              id="idp-scopes"
              label="Scopes (espacio)"
              value={scopesText}
              onChange={(e) => setScopesText(e.target.value)}
            />
          </div>
          <div style={{ marginTop: '0.75rem' }}>
            <M3Button
              variant="filled"
              onClick={handleRegister}
              disabled={submitting}
              data-testid="idp-register-submit"
            >
              {submitting ? 'Guardando...' : 'Registrar Proveedor IdP'}
            </M3Button>
          </div>
        </div>
      )}

      <div className="m3-stack" data-testid="idp-providers-list">
        {providers.length === 0 ? (
          <p className="m3-workspace-subtitle">
            Sin proveedores federados personalizados para <code>{targetTenantId}</code>.
          </p>
        ) : (
          providers.map((item) => (
            <div key={item.id} className="m3-card m3-card--outlined" style={{ padding: '1rem' }}>
              <div className="m3-panel-header">
                <div>
                  <strong>{item.displayName}</strong> <code>({item.providerKey})</code>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <M3Chip label={item.protocol.toUpperCase()} tone="primary" />
                  <M3Chip
                    label={item.hasClientSecret ? 'Secret: AES-256-GCM (hidden)' : 'No Secret'}
                    tone="success"
                  />
                  {canManage && (
                    <M3Button
                      variant="outlined"
                      onClick={() => handleRemove(item.providerKey)}
                      data-testid={`idp-remove-${item.providerKey}`}
                    >
                      Eliminar
                    </M3Button>
                  )}
                </div>
              </div>
              <p className="m3-workspace-subtitle" style={{ marginTop: '0.35rem' }}>
                Issuer: <code>{item.issuerUrl}</code> · Client ID: <code>{item.clientId}</code>
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
