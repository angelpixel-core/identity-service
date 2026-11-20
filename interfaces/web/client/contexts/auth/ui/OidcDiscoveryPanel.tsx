import { useState } from 'react';
import {
  M3AlertBanner,
  M3Button,
  M3JsonViewer,
} from '../../../design-system/components/M3Primitives';
import { apiRequest } from '../../../shared/api_client';

interface OidcDiscoveryState {
  readonly discovery: unknown;
  readonly jwks: unknown;
  readonly traceparent: string | null;
}

/**
 * Inspector en vivo de OIDC Discovery & JWKS (US-07).
 */
export function OidcDiscoveryPanel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OidcDiscoveryState | null>(null);

  const handleFetchOidc = async () => {
    setLoading(true);
    setError(null);
    try {
      const [discRes, jwksRes] = await Promise.all([
        apiRequest('/.well-known/openid-configuration'),
        apiRequest('/.well-known/jwks.json'),
      ]);
      if (!discRes.ok || !jwksRes.ok) {
        setError('No se pudo consultar el servidor OIDC.');
        return;
      }
      setResult({
        discovery: discRes.data,
        jwks: jwksRes.data,
        traceparent: discRes.trace.traceparent ?? jwksRes.trace.traceparent,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de red consultando OIDC');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="m3-stack">
      <div className="m3-panel-header">
        <div>
          <h2 className="m3-section-title" style={{ marginBottom: '0.25rem' }}>
            OIDC Discovery &amp; JWKS (US-07)
          </h2>
          <p className="m3-workspace-subtitle">
            Inspecciona en vivo <code>/.well-known/openid-configuration</code> y{' '}
            <code>/.well-known/jwks.json</code>.
          </p>
        </div>
        <M3Button variant="filled" onClick={handleFetchOidc} disabled={loading}>
          {loading ? 'Consultando...' : 'Consultar Discovery & JWKS'}
        </M3Button>
      </div>

      {error && (
        <M3AlertBanner severity="error" title="Error OIDC" message={error} />
      )}

      {result && (
        <div className="m3-stack">
          <M3JsonViewer
            title="OpenID Connect Discovery"
            badge={result.traceparent ?? 'OIDC 1.0'}
            data={result.discovery}
            testId="oidc-discovery-viewer"
          />
          <M3JsonViewer
            title="Public RSA JWKS (RFC 7517)"
            badge="RS256"
            data={result.jwks}
            testId="oidc-jwks-viewer"
          />
        </div>
      )}
    </div>
  );
}
