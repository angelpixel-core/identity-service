import { useState } from 'react';
import {
  M3AlertBanner,
  M3Button,
  M3JsonViewer,
  M3TextField,
} from '../../../design-system/components/M3Primitives';
import { apiRequest } from '../../../shared/api_client';

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function generatePkcePair(): Promise<{ verifier: string; challenge: string }> {
  const randomBytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(randomBytes);
  } else {
    for (let i = 0; i < randomBytes.length; i += 1) {
      randomBytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const verifier = toBase64Url(randomBytes);

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoded = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return { verifier, challenge: toBase64Url(new Uint8Array(digest)) };
  }

  return { verifier, challenge: verifier };
}

/**
 * Ejecutor de flujo Authorization Code + PKCE S256 (US-08)
 * y gestión de rotación/revocación de Refresh Tokens (US-09).
 */
export function PkceAndSessionsPanel() {
  const [clientId, setClientId] = useState('portal-web');
  const [redirectUri, setRedirectUri] = useState('https://portal.angelpixel.io/callback');
  const [verifier, setVerifier] = useState('');
  const [challenge, setChallenge] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [output, setOutput] = useState<unknown>(null);
  const [traceparent, setTraceparent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleGeneratePkce = async () => {
    const pair = await generatePkcePair();
    setVerifier(pair.verifier);
    setChallenge(pair.challenge);
    setError(null);
  };

  const handleAuthorizeAndExchange = async () => {
    setBusy(true);
    setError(null);
    try {
      const pair = verifier && challenge ? { verifier, challenge } : await generatePkcePair();
      setVerifier(pair.verifier);
      setChallenge(pair.challenge);

      const query = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: pair.challenge,
        code_challenge_method: 'S256',
      });
      const authRes = await apiRequest<{ code?: string; error?: string }>(
        `/oauth2/authorize?${query.toString()}`
      );
      if (!authRes.ok || !authRes.data?.code) {
        setOutput(authRes.data);
        setError(authRes.data?.error ?? 'Error en /oauth2/authorize');
        return;
      }

      const code = authRes.data.code;
      setAuthCode(code);

      const tokenRes = await apiRequest<{
        access_token?: string;
        refresh_token?: string;
        error?: string;
      }>('/api/v1/oauth2/token', {
        method: 'POST',
        body: {
          grant_type: 'authorization_code',
          client_id: clientId,
          redirect_uri: redirectUri,
          code,
          code_verifier: pair.verifier,
        },
      });

      setTraceparent(tokenRes.trace.traceparent);
      setOutput(tokenRes.data);
      if (!tokenRes.ok) {
        setError(tokenRes.data?.error ?? 'Error en intercambio PKCE');
        return;
      }
      if (tokenRes.data?.refresh_token) {
        setRefreshToken(tokenRes.data.refresh_token);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error ejecutando PKCE');
    } finally {
      setBusy(false);
    }
  };

  const handleRotateRefresh = async () => {
    if (!refreshToken) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest<{ refresh_token?: string; error?: string }>('/oauth2/refresh', {
        method: 'POST',
        body: { refresh_token: refreshToken, client_id: clientId },
      });
      setTraceparent(res.trace.traceparent);
      setOutput(res.data);
      if (res.ok && res.data?.refresh_token) {
        setRefreshToken(res.data.refresh_token);
      } else if (!res.ok) {
        setError(res.data?.error ?? 'Error rotando refresh token');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeSession = async () => {
    if (!refreshToken) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest('/oauth2/revoke', {
        method: 'POST',
        body: { token: refreshToken, client_id: clientId },
      });
      setTraceparent(res.trace.traceparent);
      setOutput(res.data);
      if (res.ok) {
        setRefreshToken('');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="m3-stack">
      <div>
        <h2 className="m3-section-title" style={{ marginBottom: '0.25rem' }}>
          PKCE S256 &amp; Sesiones Refresh (US-08 / US-09)
        </h2>
        <p className="m3-workspace-subtitle">
          Genera el par criptográfico PKCE en el navegador y ejecuta <code>/oauth2/authorize</code>,{' '}
          <code>/api/v1/oauth2/token</code>, <code>/oauth2/refresh</code> y <code>/oauth2/revoke</code>.
        </p>
      </div>

      <div className="m3-grid-2">
        <M3TextField
          id="pkce-client-id"
          label="Client ID"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        />
        <M3TextField
          id="pkce-redirect-uri"
          label="Redirect URI"
          value={redirectUri}
          onChange={(e) => setRedirectUri(e.target.value)}
        />
      </div>

      <div className="m3-actions-row">
        <M3Button variant="outlined" onClick={handleGeneratePkce} disabled={busy}>
          Generar Par PKCE S256
        </M3Button>
        <M3Button variant="filled" onClick={handleAuthorizeAndExchange} disabled={busy}>
          Ejecutar Authorize + Token Exchange
        </M3Button>
      </div>

      {(verifier || challenge || authCode) && (
        <M3JsonViewer
          title="Estado PKCE (WebCrypto S256)"
          badge="RFC 7636"
          data={{ code_verifier: verifier, code_challenge: challenge, code: authCode || undefined }}
          testId="pkce-state-viewer"
        />
      )}

      {refreshToken && (
        <div className="m3-actions-row">
          <M3Button variant="outlined" onClick={handleRotateRefresh} disabled={busy}>
            Rotar Refresh Token
          </M3Button>
          <M3Button variant="outlined" onClick={handleRevokeSession} disabled={busy}>
            Revocar Sesión
          </M3Button>
        </div>
      )}

      {error && <M3AlertBanner severity="error" title="Error OAuth2" message={error} />}

      {output !== null && (
        <M3JsonViewer
          title="Respuesta OAuth2 Token / Session"
          badge={traceparent ?? 'OAuth2'}
          data={output}
          testId="pkce-output-viewer"
        />
      )}
    </div>
  );
}
