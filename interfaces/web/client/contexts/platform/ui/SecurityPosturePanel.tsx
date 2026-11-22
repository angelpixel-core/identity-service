import { useEffect, useState } from 'react';
import { AuthSession } from '../../identity/domain/types';
import { apiRequest } from '../../../shared/api_client';
import {
  M3AlertBanner,
  M3Button,
  M3Card,
  M3Chip,
  M3JsonViewer,
} from '../../../design-system/components/M3Primitives';

export interface PlatformPosturePayload {
  readonly status: string;
  readonly governance: {
    readonly rootTenantId: string;
    readonly adr: string;
    readonly mode: string;
    readonly actor: {
      readonly userId: string | null;
      readonly tenantId: string | null;
      readonly roles: readonly string[];
    };
  };
  readonly infrastructurePosture: {
    readonly cloudIac: { readonly story: string; readonly provider: string; readonly tlsEndpoint: string; readonly status: string };
    readonly ingressTls: { readonly story: string; readonly protocol: string; readonly proxyMode: string; readonly status: string };
    readonly helmChart: { readonly story: string; readonly release: string; readonly schemaValidation: string; readonly networkPolicyZeroTrust: boolean };
    readonly cicdGuardrails: { readonly story: string; readonly nonRootUid: number; readonly imageTagPolicy: string; readonly rollbackCircuitBreaker: boolean };
    readonly networkPolicy: { readonly story: string; readonly defaultDenyAll: boolean; readonly allowedIngressPort: number; readonly status: string };
  };
  readonly securityPosture: {
    readonly rateLimiting: { readonly enabled: boolean; readonly windowMs: number; readonly maxRequestsPerWindow: number };
    readonly securityHeaders: { readonly helmetEnabled: boolean; readonly corsStrict: boolean; readonly hstsEnabled: boolean };
    readonly databaseTls: { readonly story: string; readonly mode: string; readonly activeGeneration: number; readonly sslEnabled: boolean; readonly minVersion: string; readonly rejectUnauthorized: boolean };
  };
  readonly vaultMetadata: {
    readonly story: string;
    readonly activeKeyId: string;
    readonly jwksKeysCount: number;
    readonly exposedKids: readonly string[];
    readonly jwksEndpoint: string;
  };
  readonly auditSummary: {
    readonly story: string;
    readonly source: string;
    readonly recentEventsCount: number;
    readonly bufferCapacity: number;
    readonly cloudWormRetentionDays: number;
  };
  readonly observability: {
    readonly w3cTraceContext: { readonly propagatedTraceparent: string | null; readonly requestId: string | null };
    readonly endpoints: { readonly metrics: string; readonly liveness: string; readonly readiness: string };
    readonly uptimeSeconds: number;
  };
  readonly timestamp: string;
}

export interface SecurityPosturePanelProps {
  session: AuthSession;
}

/**
 * Panel de Postura de Seguridad y Gobernanza Root (Solo Lectura — US-12 a US-15, US-18).
 */
export function SecurityPosturePanel({ session }: SecurityPosturePanelProps) {
  const [posture, setPosture] = useState<PlatformPosturePayload | null>(null);
  const [traceHeader, setTraceHeader] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const loadPosture = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<PlatformPosturePayload & { error?: string }>('/api/v1/platform/posture', {
        token: session.token,
        tenantId: session.tenantId,
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      });
      setTraceHeader(res.trace.traceparent ?? res.trace.requestId);
      if (!res.ok) {
        setError(res.data?.error || `Error ${res.status} cargando postura de plataforma`);
      } else {
        setPosture(res.data);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error de red consultando postura');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPosture();
  }, [session.token]);

  return (
    <div className="m3-stack">
      <M3Card variant="outlined">
        <div className="m3-toolbar">
          <div>
            <h2>Postura de Seguridad &amp; Gobernanza Root</h2>
            <p className="m3-muted">
              Vista estrictamente de solo lectura (<code>ADR-0009</code>) para controles de infraestructura (<code>US-12</code>–<code>US-15</code>, <code>US-18</code>).
            </p>
          </div>
          <M3Button variant="tonal" onClick={loadPosture} disabled={loading}>
            {loading ? 'Actualizando...' : 'Actualizar Postura'}
          </M3Button>
        </div>

        {error && <M3AlertBanner severity="error" title="Error de Postura" message={error} />}

        {posture && (
          <div className="m3-stack" data-testid="platform-posture-summary">
            <div className="m3-chip-row">
              <M3Chip label={`Root: ${posture.governance.rootTenantId}`} tone="primary" />
              <M3Chip label={posture.governance.mode} tone="neutral" />
              <M3Chip label={`DB TLS: ${posture.securityPosture.databaseTls.minVersion}`} tone="primary" />
            </div>

            <section className="m3-governance-strip" aria-label="Gobernanza Root">
              <div className="m3-governance-meta">
                <span className="m3-governance-meta__item">
                  <span className="m3-governance-meta__label">Inquilino:</span>
                  <strong>{posture.governance.rootTenantId}</strong>
                </span>
                <span className="m3-governance-meta__item">
                  <span className="m3-governance-meta__label">Operador:</span>
                  <code
                    className="m3-mono-truncate"
                    title={posture.governance.actor.userId ?? 'N/A'}
                  >
                    {posture.governance.actor.userId ?? 'N/A'}
                  </code>
                </span>
                <span className="m3-governance-meta__item">
                  <span className="m3-governance-meta__label">Roles:</span>
                  <strong>{posture.governance.actor.roles.join(', ')}</strong>
                </span>
              </div>
              <M3Chip label={posture.governance.adr} tone="primary" />
            </section>

            <div className="m3-posture-grid">
              <section className="m3-posture-card" aria-label="Infraestructura Cloud y Entrega">
                <div className="m3-posture-card__header">
                  <h3 className="m3-posture-card__title">Cloud IaC &amp; Entrega</h3>
                  <M3Chip label={`Cloud IaC: ${posture.infrastructurePosture.cloudIac.status}`} tone="success" />
                </div>
                <dl className="m3-posture-list">
                  <div className="m3-posture-row">
                    <dt>Proveedor IaC</dt>
                    <dd>{posture.infrastructurePosture.cloudIac.provider}</dd>
                  </div>
                  <div className="m3-posture-row">
                    <dt>Ingress TLS</dt>
                    <dd>
                      <M3Chip label={posture.infrastructurePosture.ingressTls.protocol} tone="success" />
                      <span>{posture.infrastructurePosture.ingressTls.proxyMode}</span>
                    </dd>
                  </div>
                  <div className="m3-posture-row">
                    <dt>Helm Chart</dt>
                    <dd>
                      <span>{posture.infrastructurePosture.helmChart.release}</span>
                      <M3Chip label={`Helm: ${posture.infrastructurePosture.helmChart.schemaValidation}`} tone="success" />
                    </dd>
                  </div>
                  <div className="m3-posture-row">
                    <dt>CI/CD Guardrails</dt>
                    <dd>
                      <M3Chip label={`UID ${posture.infrastructurePosture.cicdGuardrails.nonRootUid}`} tone="success" />
                      <code>{posture.infrastructurePosture.cicdGuardrails.imageTagPolicy}</code>
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="m3-posture-card" aria-label="Seguridad y Red">
                <div className="m3-posture-card__header">
                  <h3 className="m3-posture-card__title">Seguridad &amp; Red</h3>
                  <M3Chip label={`NetPolicy: ${posture.infrastructurePosture.networkPolicy.status}`} tone="success" />
                </div>
                <dl className="m3-posture-list">
                  <div className="m3-posture-row">
                    <dt>NetworkPolicy</dt>
                    <dd>
                      {posture.infrastructurePosture.networkPolicy.defaultDenyAll
                        ? `Default Deny · Puerto ${posture.infrastructurePosture.networkPolicy.allowedIngressPort}`
                        : 'Permissive'}
                    </dd>
                  </div>
                  <div className="m3-posture-row">
                    <dt>Base de Datos</dt>
                    <dd>
                      <M3Chip label={posture.securityPosture.databaseTls.minVersion} tone="primary" />
                      <code>{posture.securityPosture.databaseTls.mode}</code>
                    </dd>
                  </div>
                  <div className="m3-posture-row">
                    <dt>Cabeceras HTTP</dt>
                    <dd>
                      {posture.securityPosture.securityHeaders.helmetEnabled ? 'Helmet' : 'Off'} ·{' '}
                      {posture.securityPosture.securityHeaders.hstsEnabled ? 'HSTS' : 'Sin HSTS'}
                    </dd>
                  </div>
                  <div className="m3-posture-row">
                    <dt>Rate Limit</dt>
                    <dd>
                      {posture.securityPosture.rateLimiting.enabled
                        ? `${posture.securityPosture.rateLimiting.maxRequestsPerWindow} req / ${Math.round(posture.securityPosture.rateLimiting.windowMs / 1000)}s`
                        : 'Deshabilitado'}
                    </dd>
                  </div>
                </dl>
              </section>
            </div>

            {traceHeader && (
              <p className="m3-muted" data-testid="posture-traceparent">
                W3C Trace: <code>{traceHeader}</code>
              </p>
            )}

            <details className="m3-collapsible-json">
              <summary>Ver Snapshot JSON técnico (GET /api/v1/platform/posture)</summary>
              <M3JsonViewer
                title="Snapshot de Postura Read-Only (GET /api/v1/platform/posture)"
                data={posture}
                testId="platform-posture-json"
              />
            </details>
          </div>
        )}
      </M3Card>
    </div>
  );
}
