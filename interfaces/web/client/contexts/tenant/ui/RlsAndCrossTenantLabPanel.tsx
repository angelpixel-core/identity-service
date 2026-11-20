import { useState } from 'react';
import {
  M3AlertBanner,
  M3Button,
  M3JsonViewer,
  M3TextField,
} from '../../../design-system/components/M3Primitives';
import { apiRequest } from '../../../shared/api_client';
import { AuthSession } from '../../identity/domain/types';

export interface RlsAndCrossTenantLabPanelProps {
  session: AuthSession;
}

/**
 * Laboratorio en vivo de Aislamiento RLS & Guardia Cross-Tenant Zero-Trust (US-05 & US-06).
 */
export function RlsAndCrossTenantLabPanel({ session }: RlsAndCrossTenantLabPanelProps) {
  const [targetTenantId, setTargetTenantId] = useState('beta-corp');
  const [result, setResult] = useState<unknown>(null);
  const [statusCode, setStatusCode] = useState<number | null>(null);
  const [traceparent, setTraceparent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const runProbe = async (tenantHeader: string) => {
    setBusy(true);
    try {
      const res = await apiRequest(`/api/v1/users/${encodeURIComponent(session.userId)}`, {
        token: session.token,
        tenantId: tenantHeader,
      });
      setStatusCode(res.status);
      setTraceparent(res.trace.traceparent);
      setResult({ httpStatus: res.status, requestedTenant: tenantHeader, body: res.data });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="m3-stack">
      <div>
        <h2 className="m3-section-title" style={{ marginBottom: '0.25rem' }}>
          Laboratorio RLS &amp; Guardia Cross-Tenant (US-05 / US-06)
        </h2>
        <p className="m3-workspace-subtitle">
          Compara una consulta legítima bajo tu inquilino (<code>{session.tenantId}</code>) contra
          un intento de salto cross-tenant hacia otro inquilino.
        </p>
      </div>

      <M3TextField
        id="rls-target-tenant"
        label="Inquilino Objetivo (Prueba Cross-Tenant)"
        value={targetTenantId}
        onChange={(e) => setTargetTenantId(e.target.value)}
      />

      <div className="m3-actions-row">
        <M3Button variant="outlined" onClick={() => runProbe(session.tenantId)} disabled={busy}>
          Consultar Mi Inquilino ({session.tenantId})
        </M3Button>
        <M3Button variant="filled" onClick={() => runProbe(targetTenantId)} disabled={busy}>
          Probar Acceso Cross-Tenant ({targetTenantId})
        </M3Button>
      </div>

      {statusCode === 403 && (
        <M3AlertBanner
          severity="error"
          title="403 Forbidden — Bloqueo Zero-Trust Activado"
          message="El middleware detectó discrepancia entre el JWT y X-Tenant-ID y emitió CROSS_TENANT_VIOLATION."
          testId="cross-tenant-blocked-banner"
        />
      )}

      {statusCode === 200 && (
        <M3AlertBanner
          severity="success"
          title="200 OK — Aislamiento RLS Verificado"
          message={`Acceso autorizado exclusivamente dentro del contexto ${session.tenantId}.`}
        />
      )}

      {result !== null && (
        <M3JsonViewer
          title="Evidencia de Aislamiento RLS / Zero-Trust"
          badge={traceparent ?? `HTTP ${statusCode ?? '-'}`}
          data={result}
          testId="rls-lab-viewer"
        />
      )}
    </div>
  );
}
