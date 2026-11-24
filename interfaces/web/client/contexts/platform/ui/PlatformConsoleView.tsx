import { useState } from 'react';
import { AuthSession } from '../../identity/domain/types';
import { SecurityPosturePanel } from './SecurityPosturePanel';
import { VaultAndRotationPanel } from './VaultAndRotationPanel';
import { AuditExplorerPanel } from './AuditExplorerPanel';
import { SreObservabilityPanel } from './SreObservabilityPanel';
import { ClientBindingsPanel } from './ClientBindingsPanel';
import { TenantPoliciesPanel } from './TenantPoliciesPanel';

export type PlatformTab = 'posture' | 'vault' | 'bindings' | 'policies' | 'audit' | 'sre';

export interface PlatformConsoleViewProps {
  session: AuthSession;
  activeTab?: PlatformTab;
  onTabChange?: (tab: PlatformTab) => void;
}

const PLATFORM_TABS: readonly { id: PlatformTab; label: string }[] = [
  { id: 'posture', label: 'Postura & Gobernanza' },
  { id: 'vault', label: 'Bóveda Criptográfica' },
  { id: 'bindings', label: 'Bindings N:M' },
  { id: 'policies', label: 'Tenant Policies' },
  { id: 'audit', label: 'Auditoría Forense' },
  { id: 'sre', label: 'Observabilidad SRE' },
];

/**
 * Superficie /platform completa (US-26 & ADR-0009):
 * Gobernanza Root Read-Only (US-12 a US-15, US-18), Bóveda (US-16/17),
 * Auditoría Forense (US-19) y Observabilidad SRE (US-20 a US-22).
 */
export function PlatformConsoleView({
  session,
  activeTab: controlledTab,
  onTabChange,
}: PlatformConsoleViewProps) {
  const [internalTab, setInternalTab] = useState<PlatformTab>('posture');
  const activeTab = controlledTab ?? internalTab;
  const isControlled = controlledTab !== undefined;

  const handleSelect = (tab: PlatformTab) => {
    if (onTabChange) {
      onTabChange(tab);
    } else {
      setInternalTab(tab);
    }
  };

  return (
    <div className="m3-stack">
      {!isControlled && (
        <div role="tablist" aria-label="Consola de Plataforma Root" className="m3-tabs">
          {PLATFORM_TABS.map((tab) => {
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                className={`m3-tab ${isSelected ? 'm3-tab--active' : ''}`.trim()}
                onClick={() => handleSelect(tab.id)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      {activeTab === 'posture' && <SecurityPosturePanel session={session} />}
      {activeTab === 'vault' && <VaultAndRotationPanel session={session} />}
      {activeTab === 'bindings' && <ClientBindingsPanel session={session} />}
      {activeTab === 'policies' && <TenantPoliciesPanel session={session} />}
      {activeTab === 'audit' && <AuditExplorerPanel session={session} />}
      {activeTab === 'sre' && <SreObservabilityPanel />}
    </div>
  );
}
