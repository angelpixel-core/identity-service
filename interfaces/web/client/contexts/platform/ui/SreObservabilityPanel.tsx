import { useEffect, useState } from 'react';
import { apiRequest } from '../../../shared/api_client';
import {
  M3AlertBanner,
  M3Button,
  M3Card,
  M3Chip,
  M3JsonViewer,
} from '../../../design-system/components/M3Primitives';

export interface ProbeSnapshot {
  readonly live: { readonly status: number; readonly body: unknown };
  readonly ready: { readonly status: number; readonly body: unknown };
  readonly metricsRaw: string;
  readonly traceparent: string | null;
}

function extractKeyMetrics(metricsText: string): readonly string[] {
  return metricsText
    .split('\n')
    .filter((line) => line.trim().length > 0 && !line.startsWith('#'))
    .slice(0, 12);
}

/**
 * Panel de Observabilidad SRE en Vivo (US-20, US-21, US-22).
 */
export function SreObservabilityPanel() {
  const [snapshot, setSnapshot] = useState<ProbeSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const refreshTelemetry = async () => {
    setLoading(true);
    setError(null);
    const sessionTraceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    try {
      const [liveRes, readyRes, metricsRes] = await Promise.all([
        apiRequest('/health/live', { traceparent: sessionTraceparent }),
        apiRequest('/health/ready', { traceparent: sessionTraceparent }),
        apiRequest<string>('/metrics', { traceparent: sessionTraceparent }),
      ]);

      setSnapshot({
        live: { status: liveRes.status, body: liveRes.data },
        ready: { status: readyRes.status, body: readyRes.data },
        metricsRaw: typeof metricsRes.data === 'string' ? metricsRes.data : JSON.stringify(metricsRes.data),
        traceparent: liveRes.trace.traceparent ?? sessionTraceparent,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error consultando telemetría SRE');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshTelemetry();
  }, []);

  return (
    <div className="m3-stack">
      <M3Card variant="outlined">
        <div className="m3-toolbar">
          <div>
            <h2>Observabilidad SRE en Vivo (`US-20`, `US-21`, `US-22`)</h2>
            <p className="m3-muted">
              Sondas Kubernetes (`/health/live`, `/health/ready`), métricas Prometheus (`/metrics`) y correlación W3C.
            </p>
          </div>
          <M3Button variant="tonal" onClick={refreshTelemetry} disabled={loading}>
            {loading ? 'Consultando...' : 'Refrescar Telemetría'}
          </M3Button>
        </div>

        {error && <M3AlertBanner severity="error" title="Error SRE" message={error} />}

        {snapshot && (
          <div className="m3-stack" data-testid="sre-observability-summary">
            <div className="m3-chip-row">
              <M3Chip
                label={`/health/live: HTTP ${snapshot.live.status}`}
                tone={snapshot.live.status === 200 ? 'success' : 'error'}
              />
              <M3Chip
                label={`/health/ready: HTTP ${snapshot.ready.status}`}
                tone={snapshot.ready.status === 200 ? 'success' : 'warning'}
              />
              <M3Chip label="OpenMetrics / Prometheus" tone="primary" />
            </div>

            {snapshot.traceparent && (
              <p className="m3-muted" data-testid="sre-traceparent">
                W3C <code>traceparent</code>: <code>{snapshot.traceparent}</code>
              </p>
            )}

            <M3JsonViewer
              title="Estado de Sondas Kubernetes (/health/live & /health/ready)"
              data={{ live: snapshot.live.body, ready: snapshot.ready.body }}
              testId="sre-probes-json"
            />

            <M3JsonViewer
              title="Métricas Clave (/metrics)"
              data={extractKeyMetrics(snapshot.metricsRaw)}
              testId="sre-metrics-viewer"
            />
          </div>
        )}
      </M3Card>
    </div>
  );
}
