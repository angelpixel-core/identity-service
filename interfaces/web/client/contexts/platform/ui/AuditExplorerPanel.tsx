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

export interface AuditEventRecord {
  readonly timestamp?: string;
  readonly eventType: string;
  readonly severity: string;
  readonly status: string;
  readonly tenantId?: string;
  readonly actorId?: string;
  readonly traceId?: string;
  readonly trace?: { readonly traceId?: string };
}

export interface AuditEventsPayload {
  readonly status: string;
  readonly count: number;
  readonly events: readonly AuditEventRecord[];
}

export interface AuditExplorerPanelProps {
  session: AuthSession;
}

/**
 * Explorador Forense de Auditoría Estructurada (US-19 & ADR-0009).
 */
export function AuditExplorerPanel({ session }: AuditExplorerPanelProps) {
  const [tenantFilter, setTenantFilter] = useState<string>('');
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('');
  const [events, setEvents] = useState<readonly AuditEventRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const searchEvents = async (overrides?: {
    tenant?: string;
    severity?: string;
    eventType?: string;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const t = (overrides?.tenant ?? tenantFilter).trim();
      const s = (overrides?.severity ?? severityFilter).trim();
      const et = (overrides?.eventType ?? eventTypeFilter).trim();
      const params = new URLSearchParams();
      if (t) params.set('tenantId', t);
      if (s) params.set('severity', s.toUpperCase());
      if (et) params.set('eventType', et.toUpperCase());
      params.set('limit', '50');

      const query = params.toString();
      const res = await apiRequest<AuditEventsPayload & { error?: string; message?: string }>(
        `/api/v1/audit/events?${query}`,
        {
          token: session.token,
          tenantId: session.tenantId,
        }
      );

      if (!res.ok) {
        setError(res.data?.message || res.data?.error || `Error ${res.status} consultando auditoría`);
      } else {
        setEvents(Array.isArray(res.data.events) ? res.data.events : []);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error consultando eventos de auditoría');
    } finally {
      setLoading(false);
    }
  };

  const handleClearFilters = () => {
    setTenantFilter('');
    setSeverityFilter('');
    setEventTypeFilter('');
    void searchEvents({ tenant: '', severity: '', eventType: '' });
  };

  useEffect(() => {
    void searchEvents();
  }, [session.token]);

  return (
    <div className="m3-stack">
      <M3Card variant="outlined">
        <div className="m3-toolbar">
          <div>
            <h2>Explorador de Auditoría Forense (<code>US-19</code>)</h2>
            <p className="m3-muted">
              Consulta en tiempo real del ring-buffer de seguridad (<code>GET /api/v1/audit/events</code>).
            </p>
          </div>
          <M3Chip label={`Eventos cargados: ${events.length}`} tone="primary" />
        </div>

        <div className="m3-grid-form">
          <M3TextField
            id="audit-tenant-filter"
            label="Tenant ID"
            placeholder="acme-corp"
            value={tenantFilter}
            onChange={(e) => setTenantFilter(e.target.value)}
          />
          <M3TextField
            id="audit-severity-filter"
            label="Severidad"
            placeholder="WARN | CRITICAL"
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
          />
          <M3TextField
            id="audit-type-filter"
            label="Tipo de Evento"
            placeholder="CROSS_TENANT_VIOLATION"
            value={eventTypeFilter}
            onChange={(e) => setEventTypeFilter(e.target.value)}
          />
        </div>

        <div className="m3-toolbar" style={{ marginTop: '0.85rem' }}>
          <span className="m3-muted">Mostrando hasta 50 eventos recientes (orden cronológico inverso).</span>
          <div className="m3-btn-group">
            <M3Button variant="outlined" onClick={handleClearFilters} disabled={loading}>
              Limpiar
            </M3Button>
            <M3Button variant="filled" onClick={() => void searchEvents()} disabled={loading}>
              {loading ? 'Buscando...' : 'Buscar Eventos'}
            </M3Button>
          </div>
        </div>

        {error && <M3AlertBanner severity="error" title="Error de Auditoría" message={error} />}

        <div className="m3-stack" data-testid="audit-events-list" style={{ marginTop: '0.75rem' }}>
          <div className="m3-audit-table-wrap">
            <table className="m3-audit-table">
              <thead>
                <tr>
                  <th>Severidad</th>
                  <th>Evento</th>
                  <th>Estado</th>
                  <th>Tenant</th>
                  <th>Trace ID</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="m3-muted" style={{ textAlign: 'center', padding: '1.25rem' }}>
                      No se encontraron eventos para los filtros actuales.
                    </td>
                  </tr>
                ) : (
                  events.map((ev, index) => {
                    const traceId = ev.traceId ?? ev.trace?.traceId;
                    const sevTone =
                      ev.severity === 'CRITICAL' || ev.severity === 'ALERT'
                        ? 'error'
                        : ev.severity === 'WARN'
                        ? 'warning'
                        : 'neutral';
                    const statusTone =
                      ev.status === 'DENIED' || ev.status === 'FAILURE' ? 'error' : 'success';

                    return (
                      <tr key={`${ev.eventType}-${ev.timestamp ?? index}-${index}`}>
                        <td>
                          <M3Chip label={ev.severity} tone={sevTone} />
                        </td>
                        <td>
                          <code>{ev.eventType}</code>
                        </td>
                        <td>
                          <M3Chip label={ev.status} tone={statusTone} />
                        </td>
                        <td>{ev.tenantId ?? '—'}</td>
                        <td>
                          {traceId ? (
                            <code className="m3-mono-truncate" title={traceId}>
                              {traceId}
                            </code>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="m3-muted">
                          {ev.timestamp ? ev.timestamp.replace('T', ' ').slice(0, 19) : '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <details className="m3-collapsible-json">
            <summary>Ver Payload Forense técnico (JSON — GET /api/v1/audit/events)</summary>
            <M3JsonViewer title="Payload Forense (JSON)" data={events} testId="audit-events-json" />
          </details>
        </div>
      </M3Card>
    </div>
  );
}
