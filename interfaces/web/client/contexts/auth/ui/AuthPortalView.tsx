import { useEffect, useRef, useState } from 'react';
import { AuthSession, UserProfile } from '../../identity/domain/types';
import { RegisterForm } from '../../identity/ui/components/register_form';
import { LoginForm } from '../../identity/ui/components/login_form';
import { KycBadgeStatus, UserProfileCard } from '../../identity/ui/components/user_profile_card';
import { PasskeysPanel } from '../../identity/ui/components/PasskeysPanel';
import { KycVerificationPanel } from '../../identity/ui/components/KycVerificationPanel';
import { OidcDiscoveryPanel } from './OidcDiscoveryPanel';
import { PkceAndSessionsPanel } from './PkceAndSessionsPanel';
import { FederationPanel } from './FederationPanel';
import { M3AlertBanner } from '../../../design-system/components/M3Primitives';
import { apiRequest } from '../../../shared/api_client';

export type AuthTab = 'account' | 'oidc' | 'pkce' | 'federation';

export interface AuthConfigQuery {
  readonly clientId: string;
  readonly tenantId?: string;
  readonly domain?: string;
}

interface DynamicAuthConfig {
  readonly tenantId: string;
  readonly clientId: string;
  readonly requiredFields: readonly ('email' | 'password' | 'phone')[];
  readonly allowedAuthMethods: {
    readonly password: boolean;
    readonly passkeys: boolean;
    readonly federatedOidc: boolean;
  };
  readonly kycRequired: boolean;
  readonly kycMinLevel: string;
}

export interface AuthPortalViewProps {
  session: AuthSession | null;
  onSessionChange: (session: AuthSession) => void;
  onLogout: () => void;
  fetchProfile: () => Promise<UserProfile>;
  authConfigQuery?: AuthConfigQuery;
}

const AUTH_TABS: readonly { id: AuthTab; label: string }[] = [
  { id: 'account', label: 'Cuenta' },
  { id: 'oidc', label: 'OIDC & JWKS' },
  { id: 'pkce', label: 'PKCE & Sesiones' },
  { id: 'federation', label: 'Federación' },
];

function readAuthConfigQueryFromUrl(): AuthConfigQuery | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const clientId = params.get('client_id')?.trim();
  if (!clientId) return null;
  const tenantId = params.get('tenant_id')?.trim() || undefined;
  const domain = params.get('domain')?.trim() || undefined;
  return { clientId, tenantId, domain };
}

/**
 * Superficie /auth completa (US-24 / US-32):
 * Agrupa Cuenta (US-01/02/32), OIDC/JWKS (US-07), PKCE/Refresh (US-08/09) y Federación (US-10/11).
 */
export function AuthPortalView({
  session,
  onSessionChange,
  onLogout,
  fetchProfile,
  authConfigQuery,
}: AuthPortalViewProps) {
  const [activeTab, setActiveTab] = useState<AuthTab>('account');
  const [accountMode, setAccountMode] = useState<'register' | 'login'>('register');
  const [menuOpen, setMenuOpen] = useState(false);
  const [authConfig, setAuthConfig] = useState<DynamicAuthConfig | null>(null);
  const [kycStatus, setKycStatus] = useState<KycBadgeStatus | undefined>(undefined);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const effectiveQuery = authConfigQuery ?? readAuthConfigQueryFromUrl();

  useEffect(() => {
    if (!effectiveQuery?.clientId) {
      setAuthConfig(null);
      return;
    }

    const qs = new URLSearchParams({ client_id: effectiveQuery.clientId });
    if (effectiveQuery.tenantId) qs.set('tenant_id', effectiveQuery.tenantId);
    if (effectiveQuery.domain) qs.set('domain', effectiveQuery.domain);

    let cancelled = false;
    void apiRequest<DynamicAuthConfig>(`/api/v1/auth/config?${qs.toString()}`)
      .then((res) => {
        if (!cancelled && res.ok && res.data?.tenantId) {
          setAuthConfig(res.data);
        }
      })
      .catch(() => {
        // Fallback silencioso a modo standalone si /auth/config no está disponible
      });

    return () => {
      cancelled = true;
    };
  }, [effectiveQuery?.clientId, effectiveQuery?.tenantId, effectiveQuery?.domain]);

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

  const federationEnabled = authConfig ? authConfig.allowedAuthMethods.federatedOidc : true;
  const passwordEnabled = authConfig ? authConfig.allowedAuthMethods.password : true;
  const passkeysEnabled = authConfig ? authConfig.allowedAuthMethods.passkeys : true;
  const requirePhone = authConfig ? authConfig.requiredFields.includes('phone') : false;
  const defaultTenantId = authConfig?.tenantId || effectiveQuery?.tenantId || 'acme-corp';

  const visibleTabs = AUTH_TABS.filter((tab) => (tab.id === 'federation' ? federationEnabled : true));
  const activeLabel = visibleTabs.find((t) => t.id === activeTab)?.label ?? 'Cuenta';

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
              {visibleTabs.map((tab) => {
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
              <div>
                <UserProfileCard
                  fetchProfile={fetchProfile}
                  session={session}
                  kycStatus={kycStatus}
                  onLogout={onLogout}
                />
                <KycVerificationPanel
                  session={session}
                  kycRequired={Boolean(authConfig?.kycRequired)}
                  kycMinLevel={authConfig?.kycMinLevel}
                  onStatusChange={setKycStatus}
                />
                {passkeysEnabled && (
                  <PasskeysPanel session={session} clientId={effectiveQuery?.clientId} />
                )}
              </div>
            ) : !passwordEnabled ? (
              <div className="m3-stack">
                <M3AlertBanner
                  severity="warning"
                  title="Método deshabilitado"
                  message="La autenticación por contraseña está deshabilitada para este tenant."
                  testId="auth-password-disabled-banner"
                />
                {passkeysEnabled && (
                  <LoginForm
                    key={`login-pk-${defaultTenantId}`}
                    defaultTenantId={defaultTenantId}
                    disabled
                    passkeysEnabled
                    clientId={effectiveQuery?.clientId}
                    onSuccess={onSessionChange}
                  />
                )}
              </div>
            ) : (
              <div>
                <div className="m3-tabs" role="tablist" aria-label="Modo de cuenta" style={{ marginBottom: '0.75rem' }}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={accountMode === 'register'}
                    className={`m3-tab ${accountMode === 'register' ? 'm3-tab--active' : ''}`.trim()}
                    onClick={() => setAccountMode('register')}
                    data-testid="auth-mode-register"
                  >
                    Registrarse
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={accountMode === 'login'}
                    className={`m3-tab ${accountMode === 'login' ? 'm3-tab--active' : ''}`.trim()}
                    onClick={() => setAccountMode('login')}
                    data-testid="auth-mode-login"
                  >
                    Iniciar sesión
                  </button>
                </div>

                {accountMode === 'register' ? (
                  <div>
                    <h2 className="m3-section-title">Registro de Nuevo Usuario</h2>
                    <RegisterForm
                      key={`reg-${defaultTenantId}`}
                      defaultTenantId={defaultTenantId}
                      requirePhone={requirePhone}
                      kycRequired={Boolean(authConfig?.kycRequired)}
                      kycMinLevel={authConfig?.kycMinLevel}
                      onSuccess={onSessionChange}
                    />
                  </div>
                ) : (
                  <div>
                    <h2 className="m3-section-title">Iniciar Sesión</h2>
                    <LoginForm
                      key={`login-${defaultTenantId}`}
                      defaultTenantId={defaultTenantId}
                      passkeysEnabled={passkeysEnabled}
                      clientId={effectiveQuery?.clientId}
                      onSuccess={onSessionChange}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'oidc' && <OidcDiscoveryPanel />}
        {activeTab === 'pkce' && <PkceAndSessionsPanel />}
        {activeTab === 'federation' && federationEnabled && (
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
