import { useEffect, useState } from 'react';
import {
  M3AlertBanner,
  M3Button,
  M3Chip,
} from '../../../../design-system/components/M3Primitives';
import { apiRequest } from '../../../../shared/api_client';
import { AuthSession } from '../../domain/types';

export interface PasskeySummaryItem {
  readonly id: string;
  readonly credentialId: string;
  readonly deviceType: 'singleDevice' | 'multiDevice';
  readonly backedUp: boolean;
  readonly transports: readonly string[];
  readonly createdAt: string;
}

export interface PasskeysPanelProps {
  readonly session: AuthSession;
  readonly clientId?: string;
}

function base64urlToUint8Array(base64url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

function bufferToBase64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Panel de Passkeys (WebAuthn / FIDO2) en /auth -> Cuenta (US-35).
 */
export function PasskeysPanel({ session, clientId }: PasskeysPanelProps) {
  const [passkeys, setPasskeys] = useState<readonly PasskeySummaryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadPasskeys = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ passkeys?: PasskeySummaryItem[] }>('/api/v1/auth/passkeys', {
        token: session.token,
        tenantId: session.tenantId,
      });
      if (res.ok) {
        setPasskeys(Array.isArray(res.data?.passkeys) ? res.data.passkeys : []);
      }
    } catch {
      // ignore initial fetch error in offline/mocked environments
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPasskeys();
  }, [session.token, session.tenantId]);

  const handleRegisterPasskey = async () => {
    setError(null);
    setSuccess(null);

    if (typeof navigator === 'undefined' || !navigator.credentials?.create) {
      setError('WebAuthn / Passkeys no está soportado en este navegador.');
      return;
    }

    setRegistering(true);
    try {
      const optionsRes = await apiRequest<
        Record<string, any> & { message?: string; error?: string }
      >('/api/v1/auth/passkeys/register/options', {
        method: 'POST',
        token: session.token,
        tenantId: session.tenantId,
        body: {
          email: session.email,
          ...(clientId ? { clientId } : {}),
        },
      });

      if (!optionsRes.ok) {
        setError(optionsRes.data?.message ?? optionsRes.data?.error ?? 'Error iniciando registro Passkey');
        return;
      }

      const opts = optionsRes.data;
      const publicKey: PublicKeyCredentialCreationOptions = {
        ...opts,
        rp: opts.rp,
        pubKeyCredParams: Array.isArray(opts.pubKeyCredParams) ? opts.pubKeyCredParams : [],
        challenge: base64urlToUint8Array(String(opts.challenge)) as unknown as BufferSource,
        user: {
          ...opts.user,
          id: base64urlToUint8Array(String(opts.user?.id ?? session.userId)) as unknown as BufferSource,
        },
        excludeCredentials: Array.isArray(opts.excludeCredentials)
          ? opts.excludeCredentials.map((cred: any) => ({
              ...cred,
              id: base64urlToUint8Array(String(cred.id)) as unknown as BufferSource,
            }))
          : [],
      };

      const credential = (await navigator.credentials.create({
        publicKey,
      })) as PublicKeyCredential | null;

      if (!credential) {
        setError('Registro de Passkey cancelado por el usuario.');
        return;
      }

      const attestation = credential.response as AuthenticatorAttestationResponse;
      const verifyPayload = {
        id: credential.id,
        rawId: bufferToBase64url(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: bufferToBase64url(attestation.clientDataJSON),
          attestationObject: bufferToBase64url(attestation.attestationObject),
          transports:
            typeof attestation.getTransports === 'function' ? attestation.getTransports() : [],
        },
        clientExtensionResults: credential.getClientExtensionResults?.() ?? {},
      };

      const verifyRes = await apiRequest<
        PasskeySummaryItem & { message?: string; error?: string }
      >('/api/v1/auth/passkeys/register/verify', {
        method: 'POST',
        token: session.token,
        tenantId: session.tenantId,
        body: {
          ...(clientId ? { clientId } : {}),
          response: verifyPayload,
        },
      });

      if (!verifyRes.ok) {
        setError(verifyRes.data?.message ?? verifyRes.data?.error ?? 'Verificación WebAuthn fallida');
        return;
      }

      setSuccess('Passkey biométrica registrada correctamente.');
      await loadPasskeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error registrando Passkey');
    } finally {
      setRegistering(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setError(null);
    const res = await apiRequest<{ message?: string; error?: string }>(
      `/api/v1/auth/passkeys/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        token: session.token,
        tenantId: session.tenantId,
      }
    );
    if (!res.ok) {
      setError(res.data?.message ?? res.data?.error ?? 'No se pudo revocar la Passkey');
      return;
    }
    await loadPasskeys();
  };

  return (
    <div
      className="m3-card m3-card--outlined"
      style={{ padding: '1rem', marginTop: '1rem' }}
      data-testid="passkeys-panel"
    >
      <div className="m3-row-between" style={{ marginBottom: '0.75rem' }}>
        <div>
          <h3 style={{ fontSize: '0.95rem', marginBottom: '0.2rem' }}>
            Passkeys / Biometría (WebAuthn FIDO2)
          </h3>
          <p className="m3-workspace-subtitle">
            Credenciales públicas vinculadas a tu cuenta (cero biometría almacenada).
          </p>
        </div>
        <M3Button
          variant="tonal"
          onClick={handleRegisterPasskey}
          disabled={registering}
          data-testid="register-passkey-btn"
        >
          {registering ? 'Registrando...' : 'Registrar Passkey / Biometría'}
        </M3Button>
      </div>

      {error && (
        <M3AlertBanner
          severity="error"
          title="Error Passkey"
          message={error}
          testId="passkeys-error"
        />
      )}
      {success && (
        <M3AlertBanner
          severity="success"
          title="Passkey Activa"
          message={success}
          testId="passkeys-success"
        />
      )}

      <div className="m3-stack" data-testid="passkeys-list" style={{ marginTop: '0.5rem' }}>
        {loading && passkeys.length === 0 ? (
          <span className="m3-workspace-subtitle">Cargando credenciales...</span>
        ) : passkeys.length === 0 ? (
          <span className="m3-workspace-subtitle">No tienes Passkeys registradas aún.</span>
        ) : (
          passkeys.map((pk) => (
            <div key={pk.id} className="m3-row-between" style={{ padding: '0.4rem 0' }}>
              <div className="m3-cluster">
                <M3Chip label={pk.deviceType} tone="primary" />
                {pk.backedUp && <M3Chip label="Backed up" tone="success" />}
                <code>{pk.credentialId.slice(0, 16)}...</code>
              </div>
              <M3Button
                variant="text"
                onClick={() => handleRevoke(pk.id)}
                data-testid={`revoke-passkey-${pk.id}`}
              >
                Revocar
              </M3Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
