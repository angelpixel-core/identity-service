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
              Vista estrictamente de solo lectura (`ADR-0009`) para controles de infraestructura (`US-12`–`US-15`, `US-18`).
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
              <M3Chip label={`Cloud IaC: ${posture.infrastructurePosture.cloudIac.status}`} tone="success" />
              <M3Chip label={`Ingress: ${posture.infrastructurePosture.ingressTls.protocol}`} tone="success" />
              <M3Chip label={`Helm: ${posture.infrastructurePosture.helmChart.schemaValidation}`} tone="success" />
              <M3Chip label={`CI/CD UID: ${posture.infrastructurePosture.cicdGuardrails.nonRootUid}`} tone="success" />
              <M3Chip label={`NetPolicy: ${posture.infrastructurePosture.networkPolicy.status}`} tone="success" />
              <M3Chip label={`DB TLS: ${posture.securityPosture.databaseTls.minVersion}`} tone="primary" />
            </div>

            {traceHeader && (
              <p className="m3-muted" data-testid="posture-traceparent">
                W3C Trace: <code>{traceHeader}</code>
              </p>
            )}

            <M3JsonViewer
              title="Snapshot de Postura Read-Only (GET /api/v1/platform/posture)"
              data={posture}
              testId="platform-posture-json"
            />
          </div>
        )}
      </M3Card>
    </div>
  );
}
