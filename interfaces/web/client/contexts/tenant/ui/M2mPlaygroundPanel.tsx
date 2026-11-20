import { useState } from 'react';
import {
  M3AlertBanner,
  M3Button,
  M3JsonViewer,
  M3TextField,
} from '../../../design-system/components/M3Primitives';
import { apiRequest } from '../../../shared/api_client';

/**
 * M2M Client Credentials Playground (US-04).
 */
export function M2mPlaygroundPanel() {
  const [clientId, setClientId] = useState('m2m-service-app');
  const [clientSecret, setClientSecret] = useState('');
  const [scope, setScope] = useState('identity:read');
  const [result, setResult] = useState<unknown>(null);
  const [traceparent, setTraceparent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleRequestToken = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest<{ error?: string; error_description?: string }>(
        '/api/v1/oauth2/token',
        {
          method: 'POST',
          body: {
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
            scope,
          },
        }
      );
      setTraceparent(res.trace.traceparent);
      setResult(res.data);
      if (!res.ok) {
        setError(res.data?.error_description ?? res.data?.error ?? 'Error emitiendo token M2M');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="m3-stack">
      <div>
        <h2 className="m3-section-title" style={{ marginBottom: '0.25rem' }}>
          M2M Client Credentials Playground (US-04)
        </h2>
        <p className="m3-workspace-subtitle">
          Emite tokens Bearer M2M reales contra <code>POST /api/v1/oauth2/token</code>.
        </p>
      </div>

      <div className="m3-grid-2">
        <M3TextField
          id="m2m-client-id"
          label="Client ID"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        />
        <M3TextField
          id="m2m-client-secret"
          label="Client Secret"
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
        />
      </div>

      <M3TextField
        id="m2m-scope"
        label="Scopes Solicitados"
        value={scope}
        onChange={(e) => setScope(e.target.value)}
      />

      <div>
        <M3Button variant="filled" onClick={handleRequestToken} disabled={busy}>
          {busy ? 'Solicitando...' : 'Solicitar Token M2M'}
        </M3Button>
      </div>

      {error && <M3AlertBanner severity="error" title="Error M2M" message={error} />}

      {result !== null && (
        <M3JsonViewer
          title="Respuesta Token M2M"
          badge={traceparent ?? 'client_credentials'}
          data={result}
          testId="m2m-output-viewer"
        />
      )}
    </div>
  );
}
