import { useState } from 'react';
import { AuthSession } from '../../identity/domain/types';
import { ClientRegistryPanel } from './ClientRegistryPanel';
import { M2mPlaygroundPanel } from './M2mPlaygroundPanel';
import { RlsAndCrossTenantLabPanel } from './RlsAndCrossTenantLabPanel';
import { TenantPolicyPanel } from './TenantPolicyPanel';
import { TenantFederatedProvidersPanel } from './TenantFederatedProvidersPanel';

export type TenantTab = 'clients' | 'policy' | 'federation' | 'm2m' | 'rls';

export interface TenantConsoleViewProps {
  session: AuthSession;
}

const TENANT_TABS: readonly { id: TenantTab; label: string }[] = [
  { id: 'clients', label: 'Clientes & CORS' },
  { id: 'policy', label: 'Política de Identidad' },
  { id: 'federation', label: 'Proveedores IdP' },
  { id: 'm2m', label: 'M2M Playground' },
  { id: 'rls', label: 'Laboratorio RLS / Cross-Tenant' },
];

/**
 * Superficie /tenant completa (US-25):
 * Client Registry (US-03), M2M Playground (US-04) y Laboratorio RLS/Cross-Tenant (US-05/06).
 */
export function TenantConsoleView({ session }: TenantConsoleViewProps) {
  const [activeTab, setActiveTab] = useState<TenantTab>('clients');

  return (
    <div className="m3-stack">
      <div role="tablist" aria-label="Consola de Inquilino" className="m3-tabs">
        {TENANT_TABS.map((tab) => {
          const isSelected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              className={`m3-tab ${isSelected ? 'm3-tab--active' : ''}`.trim()}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'clients' && <ClientRegistryPanel session={session} />}
      {activeTab === 'policy' && <TenantPolicyPanel session={session} />}
      {activeTab === 'federation' && <TenantFederatedProvidersPanel session={session} />}
      {activeTab === 'm2m' && <M2mPlaygroundPanel />}
      {activeTab === 'rls' && <RlsAndCrossTenantLabPanel session={session} />}
    </div>
  );
}
