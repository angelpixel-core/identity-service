import { useState } from 'react';
import { M3Button, M3TextField } from '../../../design-system/components/M3Primitives';
import { AuthSession } from '../../identity/domain/types';
import { TenantPolicyEditor } from '../../tenant/ui/TenantPolicyPanel';

export interface TenantPoliciesPanelProps {
  session: AuthSession;
}

/**
 * Panel Root Governance (/platform): Gestión de políticas por tenant (US-30).
 */
export function TenantPoliciesPanel({ session }: TenantPoliciesPanelProps) {
  const [draftTenantId, setDraftTenantId] = useState(session.tenantId || 'acme-corp');
  const [selectedTenantId, setSelectedTenantId] = useState(session.tenantId || 'acme-corp');

  const handleSelectTenant = () => {
    const trimmed = draftTenantId.trim();
    if (trimmed) {
      setSelectedTenantId(trimmed);
    }
  };

  return (
    <div className="m3-stack" data-testid="platform-policies-panel">
      <div className="m3-panel-header">
        <div>
          <h2 className="m3-section-title" style={{ marginBottom: '0.25rem' }}>
            Políticas de Identidad por Tenant (US-30)
          </h2>
          <p className="m3-workspace-subtitle">
            Gobernanza centralizada de atributos requeridos, KYC y métodos de autenticación por inquilino.
          </p>
        </div>
      </div>

      <div className="m3-card m3-card--tonal" style={{ padding: '1rem' }}>
        <div className="m3-row-between" style={{ gap: '0.75rem', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <M3TextField
              id="platform-policy-tenant-id"
              label="Tenant ID objetivo"
              value={draftTenantId}
              onChange={(e) => setDraftTenantId(e.target.value)}
              helperText="Ej: acme-corp, globex, demo-tenant"
            />
          </div>
          <M3Button
            variant="tonal"
            onClick={handleSelectTenant}
            data-testid="platform-policy-load-tenant-btn"
          >
            Seleccionar Tenant
          </M3Button>
        </div>
      </div>

      <TenantPolicyEditor
        tenantId={selectedTenantId}
        session={session}
        readOnly={false}
        testIdPrefix="platform-policy"
      />
    </div>
  );
}
