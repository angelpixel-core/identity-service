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
  const nonComment = metricsText
    .split('\n')
    .filter((line) => line.trim().length > 0 && !line.startsWith('#'));
  const prioritized = nonComment.filter(
    (line) =>
      line.startsWith('http_requests_total') ||
      line.startsWith('http_request_duration_seconds_count') ||
      line.startsWith('http_request_duration_seconds_sum')
  );
  const rest = nonComment.filter((line) => !prioritized.includes(line));
  return [...prioritized, ...rest].slice(0, 12);
}

interface GoldenSignalsSummary {
  readonly totalRequests: number;
  readonly errorRequests: number;
  readonly avgLatencyMs: string;
  readonly normalizedRoutesCount: number;
}

function extractGoldenSignals(metricsText: string): GoldenSignalsSummary {
  const lines = metricsText.split('\n');
  let requestsTotalSum = 0;
  let durationCountSum = 0;
  let durationSumTotal = 0;
  let errorSum = 0;
  const routes = new Set<string>();

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const spaceIdx = line.lastIndexOf(' ');
    if (spaceIdx <= 0) continue;
    const val = parseFloat(line.slice(spaceIdx + 1));
    if (!Number.isFinite(val)) continue;

    const routeMatch = line.match(/route="([^"]+)"/);
    if (routeMatch?.[1]) routes.add(routeMatch[1]);

    const statusMatch = line.match(/status_code="([45]\d\d)"/);
    if (line.startsWith('http_requests_total')) {
      requestsTotalSum += val;
      if (statusMatch) errorSum += val;
    } else if (line.startsWith('http_request_duration_seconds_count')) {
      durationCountSum += val;
      if (statusMatch) errorSum += val;
    } else if (line.startsWith('http_request_duration_seconds_sum')) {
      durationSumTotal += val;
    }
  }

  const totalRequests = requestsTotalSum > 0 ? requestsTotalSum : durationCountSum;
  const avgLatencyMs =
    durationCountSum > 0 ? `${((durationSumTotal / durationCountSum) * 1000).toFixed(2)} ms` : '—';

  return {
    totalRequests,
    errorRequests: errorSum,
    avgLatencyMs,
    normalizedRoutesCount: routes.size,
  };
}

/**
 * Panel de Observabilidad SRE en Vivo (US-20, US-21, US-22).
 */
export function SreObservabilityPanel() {
  const [snapshot, setSnapshot] = useState<ProbeSnapshot | null>(null);
  const [copiedTrace, setCopiedTrace] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const handleCopyTraceId = async (traceId: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(traceId);
      }
      setCopiedTrace(true);
      setTimeout(() => setCopiedTrace(false), 1500);
    } catch {
      // No-op defensivo
    }
  };

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

  const extractedTraceId = snapshot?.traceparent?.split('-')[1] ?? '';
  const keyMetrics = snapshot ? extractKeyMetrics(snapshot.metricsRaw) : [];
  const goldenSignals = snapshot ? extractGoldenSignals(snapshot.metricsRaw) : null;
  const readyBody = snapshot?.ready.body as
    | { readonly checks?: { readonly database?: string; readonly cache?: string } }
    | undefined;
  const dbCheck = readyBody?.checks?.database;
  const cacheCheck = readyBody?.checks?.cache;

  return (
    <div className="m3-stack">
      <M3Card variant="outlined">
        <div className="m3-toolbar">
          <div>
            <h2>
              Observabilidad SRE en Vivo (<code>US-20</code>, <code>US-21</code>, <code>US-22</code>)
            </h2>
            <p className="m3-muted">
              Sondas Kubernetes (<code>/health/live</code>, <code>/health/ready</code>), métricas Prometheus (<code>/metrics</code>) y correlación W3C.
            </p>
          </div>
          <M3Button variant="filled" onClick={refreshTelemetry} disabled={loading}>
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
                tone={snapshot.ready.status === 200 ? 'success' : 'error'}
              />
              <M3Chip label="OpenMetrics / Prometheus" tone="primary" />
            </div>

            {snapshot.traceparent && (
              <section className="m3-governance-strip" aria-label="W3C Trace Context" data-testid="sre-traceparent">
                <div className="m3-governance-meta">
                  <span className="m3-governance-meta__item">
                    <span className="m3-governance-meta__label">
                      W3C <code>traceparent</code>:
                    </span>
                    <code>{snapshot.traceparent}</code>
                  </span>
                </div>
                {extractedTraceId && (
                  <span className="m3-trace-cell">
                    <M3Chip label={`traceId: ${extractedTraceId.slice(0, 8)}…`} tone="neutral" />
                    <button
                      type="button"
                      className="m3-copy-btn"
                      onClick={() => void handleCopyTraceId(extractedTraceId)}
                      title={copiedTrace ? '¡traceId copiado!' : 'Copiar traceId para Auditoría Forense'}
                      aria-label="Copiar traceId"
                      data-testid="sre-copy-trace-btn"
                    >
                      {copiedTrace ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      )}
                    </button>
                  </span>
                )}
              </section>
            )}

            <div className="m3-posture-grid">
              <section className="m3-posture-card" aria-label="Sondas Kubernetes">
                <div className="m3-posture-card__header">
                  <h3 className="m3-posture-card__title">Sondas Kubernetes (US-22)</h3>
                  <M3Chip
                    label={snapshot.live.status === 200 && snapshot.ready.status === 200 ? 'HEALTHY' : 'DEGRADED'}
                    tone={snapshot.live.status === 200 && snapshot.ready.status === 200 ? 'success' : 'error'}
                  />
                </div>
                <dl className="m3-posture-list">
                  <div className="m3-posture-row">
                    <dt>Liveness</dt>
                    <dd>
                      <code>/health/live</code>
                      <M3Chip label={`HTTP ${snapshot.live.status}`} tone={snapshot.live.status === 200 ? 'success' : 'error'} />
                    </dd>
                  </div>
                  <div className="m3-posture-row">
                    <dt>Readiness</dt>
                    <dd>
                      <code>/health/ready</code>
                      <M3Chip label={`HTTP ${snapshot.ready.status}`} tone={snapshot.ready.status === 200 ? 'success' : 'error'} />
                    </dd>
                  </div>
                  {dbCheck && (
                    <div className="m3-posture-row">
                      <dt>PostgreSQL</dt>
                      <dd>
                        <M3Chip label={dbCheck} tone={dbCheck === 'OK' ? 'success' : 'error'} />
                      </dd>
                    </div>
                  )}
                  {cacheCheck && (
                    <div className="m3-posture-row">
                      <dt>Redis Cache</dt>
                      <dd>
                        <M3Chip label={cacheCheck} tone={cacheCheck === 'OK' ? 'success' : 'error'} />
                      </dd>
                    </div>
                  )}
                </dl>
              </section>

              <section className="m3-posture-card" aria-label="Métricas OpenMetrics">
                <div className="m3-posture-card__header">
                  <h3 className="m3-posture-card__title">Métricas OpenMetrics (US-21)</h3>
                  <M3Chip
                    label={`${goldenSignals?.normalizedRoutesCount ?? 0} rutas · ${keyMetrics.length} series`}
                    tone="primary"
                  />
                </div>
                <dl className="m3-posture-list">
                  <div className="m3-posture-row">
                    <dt>Tráfico HTTP</dt>
                    <dd>
                      <M3Chip label={`${goldenSignals?.totalRequests ?? 0} req`} tone="success" />
                      <code>GET /metrics</code>
                    </dd>
                  </div>
                  <div className="m3-posture-row">
                    <dt>Latencia Promedio</dt>
                    <dd>{goldenSignals?.avgLatencyMs ?? '—'}</dd>
                  </div>
                  <div className="m3-posture-row">
                    <dt>Errores (4xx / 5xx)</dt>
                    <dd>
                      <M3Chip
                        label={`${goldenSignals?.errorRequests ?? 0}`}
                        tone={(goldenSignals?.errorRequests ?? 0) > 0 ? 'warning' : 'success'}
                      />
                    </dd>
                  </div>
                </dl>
              </section>
            </div>

            <details className="m3-collapsible-json">
              <summary>Ver Estado de Sondas Kubernetes (JSON — /health/live &amp; /health/ready)</summary>
              <M3JsonViewer
                title="Estado de Sondas Kubernetes (/health/live & /health/ready)"
                data={{ live: snapshot.live.body, ready: snapshot.ready.body }}
                testId="sre-probes-json"
              />
            </details>

            <details className="m3-collapsible-json">
              <summary>Ver Métricas Clave (/metrics — {keyMetrics.length} muestras)</summary>
              <M3JsonViewer
                title="Métricas Clave (/metrics)"
                data={keyMetrics}
                testId="sre-metrics-viewer"
              />
            </details>
          </div>
        )}
      </M3Card>
    </div>
  );
}
