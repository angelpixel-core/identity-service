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

  const searchEvents = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (tenantFilter.trim()) params.set('tenantId', tenantFilter.trim());
      if (severityFilter.trim()) params.set('severity', severityFilter.trim().toUpperCase());
      if (eventTypeFilter.trim()) params.set('eventType', eventTypeFilter.trim().toUpperCase());
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

  useEffect(() => {
    void searchEvents();
  }, [session.token]);

  return (
    <div className="m3-stack">
      <M3Card variant="outlined">
        <h2>Explorador de Auditoría Forense (`US-19`)</h2>
        <p className="m3-muted">
          Consulta en tiempo real del ring-buffer de seguridad (`GET /api/v1/audit/events`).
        </p>

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

        <div className="m3-toolbar" style={{ marginTop: '0.75rem' }}>
          <M3Chip label={`Eventos cargados: ${events.length}`} tone="primary" />
          <M3Button variant="filled" onClick={searchEvents} disabled={loading}>
            {loading ? 'Buscando...' : 'Buscar Eventos'}
          </M3Button>
        </div>

        {error && <M3AlertBanner severity="error" title="Error de Auditoría" message={error} />}

        <div className="m3-stack" data-testid="audit-events-list" style={{ marginTop: '1rem' }}>
          {events.map((ev, index) => (
            <M3Card key={`${ev.eventType}-${index}`} variant="tonal">
              <div className="m3-chip-row">
                <M3Chip
                  label={ev.severity}
                  tone={ev.severity === 'CRITICAL' || ev.severity === 'ALERT' ? 'error' : ev.severity === 'WARN' ? 'warning' : 'neutral'}
                />
                <M3Chip label={ev.eventType} tone="primary" />
                <M3Chip label={ev.status} tone={ev.status === 'DENIED' ? 'error' : 'success'} />
                {ev.tenantId && <M3Chip label={`tenant: ${ev.tenantId}`} tone="neutral" />}
              </div>
              {ev.traceId && (
                <p className="m3-muted">
                  Trace ID: <code>{ev.traceId}</code>
                </p>
              )}
            </M3Card>
          ))}
          <M3JsonViewer title="Payload Forense (JSON)" data={events} testId="audit-events-json" />
        </div>
      </M3Card>
    </div>
  );
}
