import { useEffect, useState } from 'react';
import { AuthSession } from '../../identity/domain/types';
import { apiRequest } from '../../../shared/api_client';
import {
  M3AlertBanner,
  M3Button,
  M3Card,
  M3Chip,
  M3JsonViewer,
  M3TextField,
} from '../../../design-system/components/M3Primitives';

export interface SecretsStatusPayload {
  readonly status: string;
  readonly signingKeys: {
    readonly activeKeyId: string;
    readonly retainedKeysCount: number;
    readonly jwksKeysCount: number;
    readonly exposedKids: readonly string[];
    readonly jwksEndpoint: string;
  };
  readonly databasePool: {
    readonly mode: string;
    readonly activeGeneration: number;
    readonly ssl?: {
      readonly enabled: boolean;
      readonly minVersion: string;
      readonly rejectUnauthorized: boolean;
    };
  };
  readonly timestamp: string;
}

export interface VaultAndRotationPanelProps {
  session: AuthSession;
}

/**
 * Panel de Bóveda Criptográfica & Rotación en Caliente (US-16 & US-17).
 * Nunca expone material privado en claro y exige confirmación explícita para rotar llaves.
 */
export function VaultAndRotationPanel({ session }: VaultAndRotationPanelProps) {
  const [vaultStatus, setVaultStatus] = useState<SecretsStatusPayload | null>(null);
  const [requestedKeyId, setRequestedKeyId] = useState<string>('');
  const [confirmRotation, setConfirmRotation] = useState<boolean>(false);
  const [rotationResult, setRotationResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const loadStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<SecretsStatusPayload & { error?: string }>('/api/v1/secrets/status', {
        token: session.token,
        tenantId: session.tenantId,
      });
      if (!res.ok) {
        setError(res.data?.error || `Error ${res.status} consultando estado de bóveda`);
      } else {
        setVaultStatus(res.data);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error consultando bóveda');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, [session.token]);

  const handleRotateSigningKey = async () => {
    if (!confirmRotation) return;
    setLoading(true);
    setError(null);
    try {
      const body = requestedKeyId.trim().length > 0 ? { keyId: requestedKeyId.trim() } : {};
      const res = await apiRequest<{ activeKeyId?: string; error?: string }>(
        '/api/v1/secrets/rotate-signing-key',
        {
          method: 'POST',
          token: session.token,
          tenantId: session.tenantId,
          body,
        }
      );
      if (!res.ok) {
        setError(res.data?.error || `Error ${res.status} rotando llave RSA`);
      } else {
        setRotationResult(res.data);
        setConfirmRotation(false);
        setRequestedKeyId('');
        await loadStatus();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error ejecutando rotación');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="m3-stack">
      <M3Card variant="outlined">
        <div className="m3-toolbar">
          <div>
            <h2>Bóveda Criptográfica &amp; Rotación Sin Downtime</h2>
            <p className="m3-muted">
              Metadatos activos RSA-2048 (<code>US-16</code>) y postura TLS de base de datos (<code>US-17</code>) sin secretos en claro.
            </p>
          </div>
          <M3Button variant="tonal" onClick={loadStatus} disabled={loading}>
            Refrescar Bóveda
          </M3Button>
        </div>

        {error && <M3AlertBanner severity="error" title="Error de Bóveda" message={error} />}

        {vaultStatus && (
          <div className="m3-stack" data-testid="vault-status-summary">
            <div className="m3-chip-row">
              <M3Chip label={`Active Key: ${vaultStatus.signingKeys.activeKeyId}`} tone="primary" />
              <M3Chip label={`JWKS Keys: ${vaultStatus.signingKeys.jwksKeysCount}`} tone="success" />
              <M3Chip label={`Pool Gen: ${vaultStatus.databasePool.activeGeneration}`} tone="neutral" />
            </div>

            <div className="m3-posture-grid">
              <section className="m3-posture-card" aria-label="Llaves de Firma RSA-2048">
                <div className="m3-posture-card__header">
                  <h3 className="m3-posture-card__title">Llaves de Firma RSA-2048</h3>
                  <M3Chip label={vaultStatus.status} tone="success" />
                </div>
                <dl className="m3-posture-list">
                  <div className="m3-posture-row">
                    <dt>Llave Activa</dt>
                    <dd>
                      <code className="m3-mono-truncate" title={vaultStatus.signingKeys.activeKeyId}>
                        {vaultStatus.signingKeys.activeKeyId}
                      </code>
                    </dd>
                  </div>
                  <div className="m3-posture-row">
                    <dt>Llaves en JWKS</dt>
                    <dd>
                      <M3Chip label={`${vaultStatus.signingKeys.jwksKeysCount} activas`} tone="success" />
                      <span>({vaultStatus.signingKeys.retainedKeysCount} retenidas)</span>
                    </dd>
                  </div>
                  <div className="m3-posture-row">
                    <dt>Endpoint JWKS</dt>
                    <dd>
                      <code>{vaultStatus.signingKeys.jwksEndpoint}</code>
                    </dd>
                  </div>
                  <div className="m3-posture-row">
                    <dt>KIDs Expuestos</dt>
                    <dd>
                      <code className="m3-mono-truncate" title={vaultStatus.signingKeys.exposedKids.join(', ')}>
                        {vaultStatus.signingKeys.exposedKids.join(', ')}
                      </code>
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="m3-posture-card" aria-label="Pool PostgreSQL y TLS">
                <div className="m3-posture-card__header">
                  <h3 className="m3-posture-card__title">Pool PostgreSQL &amp; TLS</h3>
                  <M3Chip label={`Gen ${vaultStatus.databasePool.activeGeneration}`} tone="primary" />
                </div>
                <dl className="m3-posture-list">
                  <div className="m3-posture-row">
                    <dt>Modo del Pool</dt>
                    <dd>
                      <code>{vaultStatus.databasePool.mode}</code>
                    </dd>
                  </div>
                  <div className="m3-posture-row">
                    <dt>TLS en Tránsito</dt>
                    <dd>
                      <M3Chip
                        label={vaultStatus.databasePool.ssl?.enabled ? 'SSL ON' : 'SSL OFF'}
                        tone={vaultStatus.databasePool.ssl?.enabled ? 'success' : 'neutral'}
                      />
                      <span>{vaultStatus.databasePool.ssl?.minVersion ?? 'TLSv1.2'}</span>
                    </dd>
                  </div>
                  <div className="m3-posture-row">
                    <dt>Validación CA</dt>
                    <dd>
                      {vaultStatus.databasePool.ssl?.rejectUnauthorized
                        ? 'Strict (rejectUnauthorized)'
                        : 'Permissive'}
                    </dd>
                  </div>
                </dl>
              </section>
            </div>

            <details className="m3-collapsible-json">
              <summary>Ver Snapshot JSON técnico (GET /api/v1/secrets/status)</summary>
              <M3JsonViewer
                title="Metadatos de Llaves y Pool (GET /api/v1/secrets/status)"
                data={vaultStatus}
                testId="vault-status-json"
              />
            </details>
          </div>
        )}
      </M3Card>

      <M3Card variant="tonal">
        <h3>
          Rotación Controlada de Llave de Firma (<code>POST /api/v1/secrets/rotate-signing-key</code>)
        </h3>
        <div className="m3-stack">
          <M3TextField
            id="rotate-key-id"
            label="Nuevo Key ID (opcional)"
            placeholder="kid_rsa_custom_2026"
            value={requestedKeyId}
            onChange={(e) => setRequestedKeyId(e.target.value)}
            helperText="Si se omite, el servidor genera un kid_rsa_* único automáticamente."
          />

          <label className="m3-checkbox-row">
            <input
              type="checkbox"
              checked={confirmRotation}
              onChange={(e) => setConfirmRotation(e.target.checked)}
              data-testid="confirm-rotation-checkbox"
            />
            <span>Confirmo rotar la llave RSA activa manteniendo la llave previa en JWKS durante el periodo de gracia.</span>
          </label>

          <div>
            <M3Button
              variant="filled"
              disabled={!confirmRotation || loading}
              onClick={handleRotateSigningKey}
            >
              Ejecutar Rotación de Llave
            </M3Button>
          </div>

          {Boolean(rotationResult) && (
            <M3JsonViewer
              title="Resultado de Rotación"
              data={rotationResult}
              testId="vault-rotation-result"
            />
          )}
        </div>
      </M3Card>
    </div>
  );
}
