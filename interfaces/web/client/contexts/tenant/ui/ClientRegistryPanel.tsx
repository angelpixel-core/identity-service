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
  readonly clientId: string;
  readonly clientName: string;
  readonly clientType: string;
  readonly allowedOrigins: readonly string[];
  readonly redirectUris: readonly string[];
  readonly allowedGrantTypes: readonly string[];
  readonly scopes: readonly string[];
  readonly isActive: boolean;
}

export interface ClientRegistryPanelProps {
  session: AuthSession;
}

/**
 * Dynamic Client Registry & CORS Validator (US-03).
 */
export function ClientRegistryPanel({ session }: ClientRegistryPanelProps) {
  const [clients, setClients] = useState<readonly SafeOAuthClient[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

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

  const handleValidateOrigin = async () => {
    setValidating(true);
    try {
      const res = await apiRequest('/api/v1/oauth2/clients/validate', {
        method: 'POST',
        headers: { Origin: validateOrigin },
        body: { clientId: validateClientId },
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

      <div className="m3-stack" data-testid="client-registry-list">
        {clients.map((client) => (
          <div key={client.clientId} className="m3-card m3-card--outlined" style={{ padding: '1rem' }}>
            <div className="m3-panel-header">
              <div>
                <strong>{client.clientName}</strong>{' '}
                <code>({client.clientId})</code>
              </div>
              <M3Chip
                label={client.isActive ? `${client.clientType} · ACTIVE` : `${client.clientType} · INACTIVE`}
                tone={client.isActive ? 'primary' : 'neutral'}
              />
            </div>
            <p className="m3-workspace-subtitle" style={{ marginTop: '0.35rem' }}>
              Origins: {client.allowedOrigins.join(', ') || '—'} · Scopes: {client.scopes.join(' ')}
            </p>
          </div>
        ))}
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
