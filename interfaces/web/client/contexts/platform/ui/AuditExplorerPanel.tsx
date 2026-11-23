import { useEffect, useMemo, useRef, useState } from 'react';
import { AuthSession } from '../../identity/domain/types';
import { apiRequest } from '../../../shared/api_client';
import {
  M3AlertBanner,
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

const PAGE_SIZE_OPTIONS = [5, 10, 20, 30, 50] as const;

/**
 * Explorador Forense de Auditoría Estructurada (US-19 & ADR-0009).
 */
export function AuditExplorerPanel({ session }: AuditExplorerPanelProps) {
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('');
  const [tenantFilter, setTenantFilter] = useState<string>('');
  const [debouncedFilters, setDebouncedFilters] = useState({
    severity: '',
    eventType: '',
    tenant: '',
  });
  const [events, setEvents] = useState<readonly AuditEventRecord[]>([]);
  const [liveStream, setLiveStream] = useState<boolean>(false);
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [pageSize, setPageSize] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const didMountRef = useRef<boolean>(false);

  const buildFilterParams = (overrides?: {
    tenant?: string;
    severity?: string;
    eventType?: string;
  }) => {
    const t = (overrides?.tenant ?? tenantFilter).trim();
    const s = (overrides?.severity ?? severityFilter).trim();
    const et = (overrides?.eventType ?? eventTypeFilter).trim();
    const params = new URLSearchParams();
    if (t) params.set('tenantId', t);
    if (s) params.set('severity', s.toUpperCase());
    if (et) params.set('eventType', et.toUpperCase());
    return params;
  };

  const searchEvents = async (overrides?: {
    tenant?: string;
    severity?: string;
    eventType?: string;
  }): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      const params = buildFilterParams(overrides);
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
        return false;
      } else {
        setEvents(Array.isArray(res.data.events) ? res.data.events : []);
        setCurrentPage(1);
        return true;
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error consultando eventos de auditoría');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleClearFilters = () => {
    setSeverityFilter('');
    setEventTypeFilter('');
    setTenantFilter('');
    setDebouncedFilters({ severity: '', eventType: '', tenant: '' });
    void searchEvents({ tenant: '', severity: '', eventType: '' });
  };

  // Carga inicial al montar o cambiar token
  useEffect(() => {
    void searchEvents();
  }, [session.token]);

  // Debounce reactivo (~350ms) para aplicar filtros en tiempo real
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedFilters({
        severity: severityFilter,
        eventType: eventTypeFilter,
        tenant: tenantFilter,
      });
      void searchEvents({
        severity: severityFilter,
        eventType: eventTypeFilter,
        tenant: tenantFilter,
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [severityFilter, eventTypeFilter, tenantFilter]);

  // Stream SSE en tiempo real (reconecta automáticamente si cambian filtros activos)
  useEffect(() => {
    if (!liveStream) return;

    const controller = new AbortController();
    let cancelled = false;

    const startStream = async () => {
      const synced = await searchEvents(debouncedFilters);
      if (!synced || cancelled) {
        setLiveStream(false);
        return;
      }

      try {
        const query = buildFilterParams(debouncedFilters).toString();
        const url = query ? `/api/v1/audit/stream?${query}` : '/api/v1/audit/stream';
        const response = await fetch(url, {
          headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${session.token}`,
            'x-tenant-id': session.tenantId,
          },
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          setError(`Error ${response.status} conectando stream en vivo`);
          setLiveStream(false);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';

          for (const frame of frames) {
            const dataLines = frame
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trim());
            if (dataLines.length === 0) continue;

            try {
              const incoming = JSON.parse(dataLines.join('\n')) as AuditEventRecord;
              setEvents((prev) => {
                const incomingKey = `${incoming.timestamp ?? ''}|${incoming.eventType}|${incoming.traceId ?? incoming.trace?.traceId ?? ''}`;
                const exists = prev.some(
                  (item) =>
                    `${item.timestamp ?? ''}|${item.eventType}|${item.traceId ?? item.trace?.traceId ?? ''}` ===
                    incomingKey
                );
                if (exists) return prev;
                return [incoming, ...prev].slice(0, 50);
              });
            } catch {
              // Ignora heartbeats/comentarios
            }
          }
        }
      } catch (err: unknown) {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : 'Stream en vivo interrumpido');
          setLiveStream(false);
        }
      }
    };

    void startStream();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    liveStream,
    debouncedFilters.severity,
    debouncedFilters.eventType,
    debouncedFilters.tenant,
    session.token,
    session.tenantId,
  ]);

  const sortedEvents = useMemo(() => {
    const copy = [...events];
    copy.sort((a, b) => {
      const ta = a.timestamp ? Date.parse(a.timestamp) : 0;
      const tb = b.timestamp ? Date.parse(b.timestamp) : 0;
      return sortOrder === 'desc' ? tb - ta : ta - tb;
    });
    return copy;
  }, [events, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(sortedEvents.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const visibleEvents = sortedEvents.slice(startIdx, startIdx + pageSize);

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
          <div className="m3-btn-group">
            <M3Chip label={`Eventos cargados: ${events.length}`} tone="primary" />
            <div className="m3-icon-actions" role="toolbar" aria-label="Acciones de sincronización">
              <button
                type="button"
                className={`m3-icon-btn ${liveStream ? 'm3-icon-btn--rec-active' : ''}`.trim()}
                onClick={() => setLiveStream((prev) => !prev)}
                aria-pressed={liveStream}
                aria-label={liveStream ? 'Pausar En vivo (SSE)' : 'Activar En vivo (SSE)'}
                data-tooltip={liveStream ? 'REC activo · Pausar SSE' : 'REC · Escuchar en vivo (SSE)'}
                data-testid="audit-live-toggle"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="12" cy="12" r="6" />
                </svg>
              </button>
              <button
                type="button"
                className="m3-icon-btn m3-icon-btn--primary"
                onClick={() => void searchEvents()}
                disabled={loading}
                aria-label="Buscar Eventos"
                data-tooltip={loading ? 'Sincronizando...' : 'Buscar / Sincronizar eventos'}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                  <path d="M16 16h5v5" />
                </svg>
              </button>
              <button
                type="button"
                className="m3-icon-btn"
                onClick={handleClearFilters}
                disabled={loading}
                aria-label="Limpiar"
                data-tooltip="Limpiar filtros"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6L6 18" />
                  <path d="M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="m3-grid-form" style={{ marginTop: '0.5rem' }}>
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
          <M3TextField
            id="audit-tenant-filter"
            label="Tenant ID"
            placeholder="acme-corp"
            value={tenantFilter}
            onChange={(e) => setTenantFilter(e.target.value)}
          />
        </div>

        {error && (
          <div style={{ marginTop: '0.85rem' }}>
            <M3AlertBanner severity="error" title="Error de Auditoría" message={error} />
          </div>
        )}

        <div className="m3-stack" data-testid="audit-events-list" style={{ marginTop: '0.85rem' }}>
          <div className="m3-audit-table-wrap">
            <table className="m3-audit-table">
              <thead>
                <tr>
                  <th>Severidad</th>
                  <th>Evento</th>
                  <th>Estado</th>
                  <th>Tenant</th>
                  <th>Trace ID</th>
                  <th>
                    <button
                      type="button"
                      className="m3-sort-btn"
                      onClick={() => setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
                      aria-label="Ordenar por Timestamp"
                    >
                      <span>Timestamp</span>
                      <span aria-hidden="true">{sortOrder === 'desc' ? '↓' : '↑'}</span>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleEvents.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="m3-muted" style={{ textAlign: 'center', padding: '1.25rem' }}>
                      No se encontraron eventos para los filtros actuales.
                    </td>
                  </tr>
                ) : (
                  visibleEvents.map((ev, index) => {
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

          <div className="m3-table-footer">
            <span>
              {sortedEvents.length === 0
                ? 'Mostrando 0 de 0 recientes.'
                : `Mostrando ${startIdx + 1}–${Math.min(startIdx + pageSize, sortedEvents.length)} de ${sortedEvents.length} recientes.`}
            </span>

            <div className="m3-pagination">
              <label htmlFor="audit-page-size">Filas:</label>
              <select
                id="audit-page-size"
                className="m3-page-select"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>

              {pageSize < 50 && (
                <>
                  <button
                    type="button"
                    className="m3-page-btn"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                    aria-label="Página anterior"
                  >
                    ◀
                  </button>
                  <span>
                    {safePage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    className="m3-page-btn"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage >= totalPages}
                    aria-label="Página siguiente"
                  >
                    ▶
                  </button>
                </>
              )}
            </div>
          </div>

          <details className="m3-collapsible-json">
            <summary>Ver Payload Forense técnico (JSON — GET /api/v1/audit/events)</summary>
            <M3JsonViewer title="Payload Forense (JSON)" data={sortedEvents} testId="audit-events-json" />
          </details>
        </div>
      </M3Card>
    </div>
  );
}
