import { useEffect, useState } from 'react';
import {
  M3AlertBanner,
  M3Button,
  M3Chip,
  M3TextField,
} from '../../../design-system/components/M3Primitives';
import { apiRequest } from '../../../shared/api_client';
import { AuthSession } from '../../identity/domain/types';

export interface ClientTenantBindingItem {
  readonly id: string;
  readonly clientId: string;
  readonly tenantId: string;
  readonly customDomain: string | null;
  readonly allowedRedirectUris: readonly string[];
  readonly allowedCorsOrigins: readonly string[];
  readonly isActive: boolean;
}

export interface ClientBindingsPanelProps {
  session: AuthSession;
}

/**
 * Panel Root Governance: Bindings N:M Client <-> Tenant / Custom Domain (US-29).
 */
export function ClientBindingsPanel({ session }: ClientBindingsPanelProps) {
  const [clientId, setClientId] = useState('portal-web');
  const [bindings, setBindings] = useState<readonly ClientTenantBindingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newTenantId, setNewTenantId] = useState('acme-corp');
  const [newDomain, setNewDomain] = useState('tienda-a.tusherramientas.com');
  const [newRedirects, setNewRedirects] = useState('https://tienda-a.tusherramientas.com/callback');
  const [newOrigins, setNewOrigins] = useState('https://tienda-a.tusherramientas.com');
  const [submitting, setSubmitting] = useState(false);

  const loadBindings = async (targetClientId = clientId) => {
    if (!targetClientId.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{
        bindings?: ClientTenantBindingItem[];
        message?: string;
        error?: string;
      }>(`/api/v1/clients/${encodeURIComponent(targetClientId.trim())}/bindings`, {
        token: session.token,
        tenantId: session.tenantId,
      });
      if (!res.ok) {
        setError(res.data?.message ?? res.data?.error ?? 'No se pudieron cargar los bindings');
        return;
      }
      setBindings(Array.isArray(res.data?.bindings) ? res.data.bindings : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de red cargando bindings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBindings('portal-web');
  }, [session.token, session.tenantId]);

  const handleCreateBinding = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiRequest<{ message?: string; error?: string }>(
        `/api/v1/clients/${encodeURIComponent(clientId.trim())}/bindings`,
        {
          method: 'POST',
          token: session.token,
          tenantId: session.tenantId,
          body: {
            tenantId: newTenantId.trim(),
            customDomain: newDomain.trim() || null,
            allowedRedirectUris: newRedirects
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
            allowedCorsOrigins: newOrigins
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          },
        }
      );
      if (!res.ok) {
        setError(res.data?.message ?? res.data?.error ?? 'No se pudo crear el binding');
        return;
      }
      await loadBindings(clientId);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (binding: ClientTenantBindingItem) => {
    setError(null);
    const res = await apiRequest<{ message?: string; error?: string }>(
      `/api/v1/clients/${encodeURIComponent(binding.clientId)}/bindings/${encodeURIComponent(binding.id)}`,
      {
        method: 'PATCH',
        token: session.token,
        tenantId: session.tenantId,
        body: { isActive: !binding.isActive },
      }
    );
    if (!res.ok) {
      setError(res.data?.message ?? res.data?.error ?? 'No se pudo actualizar el binding');
      return;
    }
    await loadBindings(binding.clientId);
  };

  const handleRevoke = async (binding: ClientTenantBindingItem) => {
    setError(null);
    const res = await apiRequest<{ message?: string; error?: string }>(
      `/api/v1/clients/${encodeURIComponent(binding.clientId)}/bindings/${encodeURIComponent(binding.id)}`,
      {
        method: 'DELETE',
        token: session.token,
        tenantId: session.tenantId,
      }
    );
    if (!res.ok) {
      setError(res.data?.message ?? res.data?.error ?? 'No se pudo revocar el binding');
      return;
    }
    await loadBindings(binding.clientId);
  };

  return (
    <div className="m3-stack" data-testid="platform-bindings-panel">
      <div className="m3-panel-header">
        <div>
          <h2 className="m3-section-title" style={{ marginBottom: '0.25rem' }}>
            Bindings Multi-Tenant &amp; Dominios Custom (US-29)
          </h2>
          <p className="m3-workspace-subtitle">
            Vinculación N:M explícita entre aplicaciones cliente, inquilinos y dominios autorizados.
          </p>
        </div>
        <M3Button variant="outlined" onClick={() => loadBindings(clientId)} disabled={loading}>
          {loading ? 'Cargando...' : 'Consultar Bindings'}
        </M3Button>
      </div>

      {error && <M3AlertBanner severity="error" title="Error de Binding" message={error} />}

      <div className="m3-card m3-card--tonal" style={{ padding: '1rem' }}>
        <h3 style={{ fontSize: '0.95rem', marginBottom: '0.75rem' }}>
          Vincular Client ↔ Tenant / Dominio
        </h3>
        <div className="m3-grid-2">
          <M3TextField
            id="binding-client-id"
            label="Client ID"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
          <M3TextField
            id="binding-tenant-id"
            label="Tenant ID"
            value={newTenantId}
            onChange={(e) => setNewTenantId(e.target.value)}
          />
          <M3TextField
            id="binding-domain"
            label="Custom Domain"
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
          />
          <M3TextField
            id="binding-origins"
            label="Allowed CORS Origins (coma)"
            value={newOrigins}
            onChange={(e) => setNewOrigins(e.target.value)}
          />
        </div>
        <div style={{ marginTop: '0.75rem' }}>
          <M3TextField
            id="binding-redirects"
            label="Allowed Redirect URIs (coma)"
            value={newRedirects}
            onChange={(e) => setNewRedirects(e.target.value)}
          />
        </div>
        <div style={{ marginTop: '0.75rem' }}>
          <M3Button
            variant="filled"
            onClick={handleCreateBinding}
            disabled={submitting}
            data-testid="create-binding-submit"
          >
            {submitting ? 'Vinculando...' : 'Crear Binding N:M'}
          </M3Button>
        </div>
      </div>

      <div className="m3-stack" data-testid="platform-bindings-list">
        {bindings.length === 0 ? (
          <p className="m3-workspace-subtitle">
            Sin bindings registrados para <code>{clientId}</code>.
          </p>
        ) : (
          bindings.map((b) => (
            <div key={b.id} className="m3-card m3-card--outlined" style={{ padding: '1rem' }}>
              <div className="m3-panel-header">
                <div>
                  <strong>{b.tenantId}</strong>{' '}
                  {b.customDomain && <code>· {b.customDomain}</code>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <M3Chip
                    label={b.isActive ? 'ACTIVE' : 'INACTIVE'}
                    tone={b.isActive ? 'primary' : 'neutral'}
                  />
                  <M3Button
                    variant="outlined"
                    onClick={() => handleToggleActive(b)}
                    data-testid={`toggle-binding-${b.id}`}
                  >
                    {b.isActive ? 'Desactivar' : 'Activar'}
                  </M3Button>
                  <M3Button
                    variant="outlined"
                    className="m3-btn--danger"
                    onClick={() => handleRevoke(b)}
                    data-testid={`revoke-binding-${b.id}`}
                  >
                    Revocar
                  </M3Button>
                </div>
              </div>
              <p className="m3-workspace-subtitle" style={{ marginTop: '0.35rem' }}>
                Redirects: {b.allowedRedirectUris.join(', ') || '—'} · CORS:{' '}
                {b.allowedCorsOrigins.join(', ') || '—'}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
