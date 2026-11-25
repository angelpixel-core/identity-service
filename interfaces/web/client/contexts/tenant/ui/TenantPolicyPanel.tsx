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

export type KycMinLevel = 'basic' | 'biometric_liveness';

export interface TenantPolicyDTO {
  readonly tenantId: string;
  readonly requiredAttributes: {
    readonly phone: boolean;
  };
  readonly kycPolicy: {
    readonly required: boolean;
    readonly minLevel: KycMinLevel;
  };
  readonly allowedAuthMethods: {
    readonly password: boolean;
    readonly passkeys: boolean;
    readonly federatedOidc: boolean;
  };
  readonly updatedAt: string;
  readonly updatedBy: string;
  readonly isDefault: boolean;
}

export interface TenantPolicyEditorProps {
  readonly tenantId: string;
  readonly session: AuthSession;
  readonly readOnly: boolean;
  readonly testIdPrefix: string;
}

/**
 * Shared TenantPolicy editor form used by both /tenant (scoped) and /platform (root).
 */
export function TenantPolicyEditor({
  tenantId,
  session,
  readOnly,
  testIdPrefix,
}: TenantPolicyEditorProps) {
  const [policy, setPolicy] = useState<TenantPolicyDTO | null>(null);
  const [phoneRequired, setPhoneRequired] = useState(false);
  const [kycRequired, setKycRequired] = useState(false);
  const [kycMinLevel, setKycMinLevel] = useState<KycMinLevel>('basic');
  const [allowPassword, setAllowPassword] = useState(true);
  const [allowPasskeys, setAllowPasskeys] = useState(true);
  const [allowFederatedOidc, setAllowFederatedOidc] = useState(true);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const applyPolicyToForm = (dto: TenantPolicyDTO) => {
    setPolicy(dto);
    setPhoneRequired(dto.requiredAttributes.phone);
    setKycRequired(dto.kycPolicy.required);
    setKycMinLevel(dto.kycPolicy.minLevel);
    setAllowPassword(dto.allowedAuthMethods.password);
    setAllowPasskeys(dto.allowedAuthMethods.passkeys);
    setAllowFederatedOidc(dto.allowedAuthMethods.federatedOidc);
  };

  const loadPolicy = async (targetTenantId: string) => {
    const normalized = targetTenantId.trim();
    if (!normalized) return;
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await apiRequest<TenantPolicyDTO & { message?: string; error?: string }>(
        `/api/v1/tenants/${encodeURIComponent(normalized)}/policy`,
        {
          token: session.token,
          tenantId: session.tenantId,
        }
      );
      if (!res.ok) {
        setError(res.data?.message ?? res.data?.error ?? 'No se pudo cargar la política');
        return;
      }
      applyPolicyToForm(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de red cargando la política');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPolicy(tenantId);
  }, [tenantId, session.token, session.tenantId]);

  const handleSave = async () => {
    if (readOnly) return;
    const normalized = tenantId.trim();
    if (!normalized) return;

    if (!allowPassword && !allowPasskeys && !allowFederatedOidc) {
      setError('Debe habilitarse al menos un método de autenticación.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await apiRequest<TenantPolicyDTO & { message?: string; error?: string }>(
        `/api/v1/tenants/${encodeURIComponent(normalized)}/policy`,
        {
          method: 'PUT',
          token: session.token,
          tenantId: session.tenantId,
          body: {
            requiredAttributes: { phone: phoneRequired },
            kycPolicy: { required: kycRequired, minLevel: kycMinLevel },
            allowedAuthMethods: {
              password: allowPassword,
              passkeys: allowPasskeys,
              federatedOidc: allowFederatedOidc,
            },
          },
        }
      );
      if (!res.ok) {
        setError(res.data?.message ?? res.data?.error ?? 'No se pudo guardar la política');
        return;
      }
      applyPolicyToForm(res.data);
      setSuccessMessage(`Política actualizada para el tenant "${res.data.tenantId}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de red guardando la política');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="m3-stack">
      <div className="m3-row-between">
        <div className="m3-cluster">
          <M3Chip
            label={policy?.isDefault ? 'Default' : 'Personalizada'}
            tone={policy?.isDefault ? 'neutral' : 'primary'}
            testId={`${testIdPrefix}-origin-chip`}
          />
          {policy && (
            <span className="m3-workspace-subtitle">
              Actualizada por <strong>{policy.updatedBy}</strong> ({policy.updatedAt})
            </span>
          )}
        </div>
        <M3Button
          variant="outlined"
          onClick={() => loadPolicy(tenantId)}
          disabled={loading}
          data-testid={`${testIdPrefix}-reload-btn`}
        >
          {loading ? 'Cargando...' : 'Recargar Política'}
        </M3Button>
      </div>

      {error && (
        <M3AlertBanner
          severity="error"
          title="Error en Política"
          message={error}
          testId={`${testIdPrefix}-error`}
        />
      )}
      {successMessage && (
        <M3AlertBanner
          severity="success"
          title="Política Guardada"
          message={successMessage}
          testId={`${testIdPrefix}-success`}
        />
      )}

      <div className="m3-grid-2">
        <div className="m3-card m3-card--outlined" style={{ padding: '1rem' }}>
          <h3 style={{ fontSize: '0.95rem', marginBottom: '0.75rem' }}>
            Atributos Requeridos &amp; KYC
          </h3>
          <div className="m3-stack">
            <label className="m3-cluster" style={{ cursor: readOnly ? 'not-allowed' : 'pointer' }}>
              <input
                type="checkbox"
                checked={phoneRequired}
                disabled={readOnly}
                onChange={(e) => setPhoneRequired(e.target.checked)}
                data-testid={`${testIdPrefix}-phone-checkbox`}
              />
              <span>Requerir teléfono en registro / onboarding</span>
            </label>

            <label className="m3-cluster" style={{ cursor: readOnly ? 'not-allowed' : 'pointer' }}>
              <input
                type="checkbox"
                checked={kycRequired}
                disabled={readOnly}
                onChange={(e) => setKycRequired(e.target.checked)}
                data-testid={`${testIdPrefix}-kyc-required-checkbox`}
              />
              <span>Exigir verificación KYC</span>
            </label>

            <div className="m3-field">
              <label htmlFor={`${testIdPrefix}-kyc-level`} className="m3-field__label">
                Nivel mínimo KYC
              </label>
              <select
                id={`${testIdPrefix}-kyc-level`}
                className="m3-field__input"
                value={kycMinLevel}
                disabled={readOnly}
                onChange={(e) => setKycMinLevel(e.target.value as KycMinLevel)}
                data-testid={`${testIdPrefix}-kyc-level-select`}
              >
                <option value="basic">basic</option>
                <option value="biometric_liveness">biometric_liveness</option>
              </select>
            </div>
          </div>
        </div>

        <div className="m3-card m3-card--outlined" style={{ padding: '1rem' }}>
          <h3 style={{ fontSize: '0.95rem', marginBottom: '0.75rem' }}>
            Métodos de Autenticación Permitidos
          </h3>
          <div className="m3-stack">
            <label className="m3-cluster" style={{ cursor: readOnly ? 'not-allowed' : 'pointer' }}>
              <input
                type="checkbox"
                checked={allowPassword}
                disabled={readOnly}
                onChange={(e) => setAllowPassword(e.target.checked)}
                data-testid={`${testIdPrefix}-auth-password-checkbox`}
              />
              <span>Password (credenciales locales)</span>
            </label>

            <label className="m3-cluster" style={{ cursor: readOnly ? 'not-allowed' : 'pointer' }}>
              <input
                type="checkbox"
                checked={allowPasskeys}
                disabled={readOnly}
                onChange={(e) => setAllowPasskeys(e.target.checked)}
                data-testid={`${testIdPrefix}-auth-passkeys-checkbox`}
              />
              <span>Passkeys / WebAuthn</span>
            </label>

            <label className="m3-cluster" style={{ cursor: readOnly ? 'not-allowed' : 'pointer' }}>
              <input
                type="checkbox"
                checked={allowFederatedOidc}
                disabled={readOnly}
                onChange={(e) => setAllowFederatedOidc(e.target.checked)}
                data-testid={`${testIdPrefix}-auth-federated-checkbox`}
              />
              <span>OIDC Federado (Google / Microsoft)</span>
            </label>
          </div>
        </div>
      </div>

      {!readOnly && (
        <div className="m3-row-between">
          <span className="m3-workspace-subtitle">
            Los cambios aplican inmediatamente al tenant <strong>{tenantId}</strong>.
          </span>
          <M3Button
            variant="filled"
            onClick={handleSave}
            disabled={saving || loading}
            data-testid={`${testIdPrefix}-save-btn`}
          >
            {saving ? 'Guardando...' : 'Guardar Política'}
          </M3Button>
        </div>
      )}

      {policy && (
        <M3JsonViewer
          title="Snapshot TenantPolicyDTO"
          badge={policy.tenantId}
          data={policy}
          testId={`${testIdPrefix}-json-viewer`}
        />
      )}
    </div>
  );
}

export interface TenantPolicyPanelProps {
  session: AuthSession;
}

/**
 * Panel Tenant Workspace (/tenant): Política de Identidad del tenant activo (US-30).
 */
export function TenantPolicyPanel({ session }: TenantPolicyPanelProps) {
  const [inspectClientId, setInspectClientId] = useState('portal-web');
  const [inspecting, setInspecting] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [inspectResult, setInspectResult] = useState<{
    status: number;
    etag: string | null;
    cacheControl: string | null;
    payload: Record<string, unknown>;
  } | null>(null);

  const handleInspectAuthConfig = async () => {
    setInspecting(true);
    setInspectError(null);
    try {
      const qs = new URLSearchParams({
        client_id: inspectClientId.trim() || 'portal-web',
        tenant_id: session.tenantId,
      });
      const response = await fetch(`/api/v1/auth/config?${qs.toString()}`);
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        setInspectResult(null);
        setInspectError(
          String(payload.error_description || payload.message || payload.error || `HTTP ${response.status}`)
        );
      } else {
        setInspectResult({
          status: response.status,
          etag: response.headers.get('etag'),
          cacheControl: response.headers.get('cache-control'),
          payload,
        });
      }
    } catch (err) {
      setInspectError(err instanceof Error ? err.message : 'Error consultando /api/v1/auth/config');
    } finally {
      setInspecting(false);
    }
  };

  const canEdit = Boolean(
    session.roles?.some(
      (role) => role === 'tenant_admin' || role === 'admin' || role === 'system:superadmin'
    )
  );

  return (
    <div className="m3-stack" data-testid="tenant-policy-panel">
      <div className="m3-panel-header">
        <div>
          <h2 className="m3-section-title" style={{ marginBottom: '0.25rem' }}>
            Política de Identidad del Tenant (US-30)
          </h2>
          <p className="m3-workspace-subtitle">
            Atributos requeridos, requisitos KYC y métodos de autenticación permitidos para{' '}
            <strong>{session.tenantId}</strong>.
          </p>
        </div>
        {!canEdit && (
          <M3Chip
            label="Solo lectura (rol member)"
            tone="warning"
            testId="tenant-policy-readonly-chip"
          />
        )}
      </div>

      {!canEdit && (
        <M3AlertBanner
          severity="info"
          title="Modo solo lectura"
          message="Tu rol actual permite consultar la política del tenant, pero solo tenant_admin o admin pueden modificarla."
          testId="tenant-policy-readonly-banner"
        />
      )}

      <TenantPolicyEditor
        tenantId={session.tenantId}
        session={session}
        readOnly={!canEdit}
        testIdPrefix="tenant-policy"
      />

      <div className="m3-card m3-card--outlined" style={{ padding: '1rem' }} data-testid="public-auth-config-inspector">
        <div className="m3-panel-header">
          <div>
            <h3 style={{ fontSize: '0.95rem', marginBottom: '0.25rem' }}>
              Inspector Público <code>/api/v1/auth/config</code> (US-31)
            </h3>
            <p className="m3-workspace-subtitle">
              Verifica en vivo la proyección pública sin secretos, cabeceras <code>ETag</code> y{' '}
              <code>Cache-Control</code> para <strong>{session.tenantId}</strong>.
            </p>
          </div>
          <M3Button
            variant="outlined"
            onClick={handleInspectAuthConfig}
            disabled={inspecting}
            data-testid="public-auth-config-inspect-btn"
          >
            {inspecting ? 'Consultando...' : 'Consultar /api/v1/auth/config'}
          </M3Button>
        </div>

        <div style={{ marginTop: '0.75rem', maxWidth: '360px' }}>
          <M3TextField
            id="public-auth-config-client-id"
            label="Client ID"
            value={inspectClientId}
            onChange={(e) => setInspectClientId(e.target.value)}
          />
        </div>

        {inspectError && (
          <div style={{ marginTop: '0.75rem' }}>
            <M3AlertBanner
              severity="error"
              title="Error en /api/v1/auth/config"
              message={inspectError}
              testId="public-auth-config-error"
            />
          </div>
        )}

        {inspectResult && (
          <div className="m3-stack" style={{ marginTop: '0.75rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <M3Chip label={`HTTP ${inspectResult.status}`} tone="success" />
              <M3Chip
                label={`ETag: ${inspectResult.etag ?? '—'}`}
                tone="primary"
                testId="public-auth-config-etag-chip"
              />
              <M3Chip
                label={`Cache-Control: ${inspectResult.cacheControl ?? '—'}`}
                tone="neutral"
              />
            </div>
            <M3JsonViewer
              title="PublicAuthConfigResponse (US-31)"
              badge={inspectClientId}
              data={inspectResult.payload}
              testId="public-auth-config-json-viewer"
            />
          </div>
        )}
      </div>
    </div>
  );
}
