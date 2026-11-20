import { useState } from 'react';
import { AuthSession, UserProfile } from '../../identity/domain/types';
import { RegisterForm } from '../../identity/ui/components/register_form';
import { UserProfileCard } from '../../identity/ui/components/user_profile_card';
import { M3Button } from '../../../design-system/components/M3Primitives';
import { OidcDiscoveryPanel } from './OidcDiscoveryPanel';
import { PkceAndSessionsPanel } from './PkceAndSessionsPanel';
import { FederationPanel } from './FederationPanel';

export type AuthTab = 'account' | 'oidc' | 'pkce' | 'federation';

export interface AuthPortalViewProps {
  session: AuthSession | null;
  onSessionChange: (session: AuthSession) => void;
  onLogout: () => void;
  fetchProfile: () => Promise<UserProfile>;
}

const AUTH_TABS: readonly { id: AuthTab; label: string }[] = [
  { id: 'account', label: 'Cuenta' },
  { id: 'oidc', label: 'OIDC & JWKS' },
  { id: 'pkce', label: 'PKCE & Sesiones' },
  { id: 'federation', label: 'Federación' },
];

/**
 * Superficie /auth completa (US-24):
 * Agrupa Cuenta (US-01/02), OIDC/JWKS (US-07), PKCE/Refresh (US-08/09) y Federación (US-10/11).
 */
export function AuthPortalView({
  session,
  onSessionChange,
  onLogout,
  fetchProfile,
}: AuthPortalViewProps) {
  const [activeTab, setActiveTab] = useState<AuthTab>('account');

  return (
    <div className="m3-stack">
      <div role="tablist" aria-label="Flujos de Autenticación e Identidad" className="m3-tabs">
        {AUTH_TABS.map((tab) => {
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

      {activeTab === 'account' && (
        <div>
          {session ? (
            <div>
              <div className="session-toolbar">
                <span>
                  Conectado como: <strong>{session.email}</strong> ({session.tenantId})
                </span>
                <M3Button variant="outlined" onClick={onLogout}>
                  Cerrar Sesión
                </M3Button>
              </div>
              <UserProfileCard fetchProfile={fetchProfile} />
            </div>
          ) : (
            <div>
              <h2 className="m3-section-title">Registro de Nuevo Usuario</h2>
              <RegisterForm defaultTenantId="acme-corp" onSuccess={onSessionChange} />
            </div>
          )}
        </div>
      )}

      {activeTab === 'oidc' && <OidcDiscoveryPanel />}
      {activeTab === 'pkce' && <PkceAndSessionsPanel />}
      {activeTab === 'federation' && (
        <FederationPanel
          onFederatedSession={(fedSession) => {
            onSessionChange(fedSession);
            setActiveTab('account');
          }}
        />
      )}
    </div>
  );
}
