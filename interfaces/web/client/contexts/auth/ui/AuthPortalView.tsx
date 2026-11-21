import { useEffect, useRef, useState } from 'react';
import { AuthSession, UserProfile } from '../../identity/domain/types';
import { RegisterForm } from '../../identity/ui/components/register_form';
import { UserProfileCard } from '../../identity/ui/components/user_profile_card';
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
  const [menuOpen, setMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const activeLabel = AUTH_TABS.find((t) => t.id === activeTab)?.label ?? 'Cuenta';

  return (
    <div className="m3-stack">
      <div className="m3-portal-selector" ref={dropdownRef}>
        <span id="portal-flow-label" className="m3-portal-selector__label">
          Flujo de Identidad
        </span>
        <div className="m3-dropdown">
          <button
            type="button"
            className="m3-dropdown__trigger"
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            aria-labelledby="portal-flow-label"
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            <span>{activeLabel}</span>
            <svg
              className={`m3-dropdown__chevron ${menuOpen ? 'm3-dropdown__chevron--open' : ''}`.trim()}
              width="12"
              height="12"
              viewBox="0 0 12 12"
              aria-hidden="true"
            >
              <path fill="currentColor" d="M2.5 4.5 6 8l3.5-3.5z" />
            </svg>
          </button>

          {menuOpen && (
            <ul
              role="listbox"
              aria-labelledby="portal-flow-label"
              className="m3-dropdown__menu"
            >
              {AUTH_TABS.map((tab) => {
                const isSelected = activeTab === tab.id;
                return (
                  <li key={tab.id} role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      className={`m3-dropdown__option ${isSelected ? 'm3-dropdown__option--active' : ''}`.trim()}
                      onClick={() => {
                        setActiveTab(tab.id);
                        setMenuOpen(false);
                      }}
                    >
                      <span>{tab.label}</span>
                      {isSelected && <span aria-hidden="true">✓</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div key={activeTab} className="m3-view-panel">
        {activeTab === 'account' && (
          <div>
            {session ? (
              <UserProfileCard fetchProfile={fetchProfile} session={session} onLogout={onLogout} />
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
    </div>
  );
}
