import React from 'react';
import { AuthSession } from '../contexts/identity/domain/types';
import {
  M3AlertBanner,
  M3Button,
  M3Card,
  M3Chip,
  M3NavItem,
  M3NavigationRail,
} from '../design-system/components/M3Primitives';

export type BoundedSurface = 'auth' | 'tenant' | 'platform';

export function resolveSurfaceFromPath(pathname: string): BoundedSurface {
  const normalized = pathname.toLowerCase();
  if (normalized.startsWith('/platform')) return 'platform';
  if (normalized.startsWith('/tenant')) return 'tenant';
  return 'auth';
}

function extractRolesFromToken(token: string): readonly string[] {
  try {
    const parts = token.split('.');
    if (parts.length < 2 || !parts[1]) return [];
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64);
    const payload = JSON.parse(json) as { roles?: unknown };
    return Array.isArray(payload.roles)
      ? payload.roles.filter((r): r is string => typeof r === 'string')
      : [];
  } catch {
    return [];
  }
}

export function isRootSuperadminSession(session: AuthSession): boolean {
  if (session.tenantId !== 'system') return false;
  const roles =
    Array.isArray(session.roles) && session.roles.length > 0
      ? session.roles
      : extractRolesFromToken(session.token);
  return roles.includes('superadmin');
}

export type PlatformNavTab =
  | 'posture'
  | 'vault'
  | 'bindings'
  | 'policies'
  | 'federation'
  | 'audit'
  | 'sre';

export interface BoundedShellProps {
  session: AuthSession | null;
  pathname?: string;
  activePlatformTab?: PlatformNavTab;
  onPlatformTabChange?: (tab: PlatformNavTab) => void;
  children: React.ReactNode;
}

const RAIL_ICONS = {
  posture: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v5c0 5-3.5 9-7 10-3.5-1-7-5-7-10V6l7-3z" />
      <path d="M9.5 12l1.8 1.8 3.5-3.8" />
    </svg>
  ),
  vault: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l8-8" />
      <path d="M16 7l2 2" />
      <path d="M18.5 4.5l2 2" />
    </svg>
  ),
  audit: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </svg>
  ),
  sre: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />
    </svg>
  ),
  bindings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  ),
  policies: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
};

/**
 * BoundedShell (US-23):
 * Separa estrictamente las superficies de UI por Bounded Context:
 * - /auth: Portal centrado estilo Google Account (sin menús administrativos).
 * - /tenant: Consola de inquilino (requiere sesión activa).
 * - /platform: Consola Root Governance (requiere system:superadmin, ADR-0009).
 */
export function BoundedShell({
  session,
  pathname,
  activePlatformTab = 'posture',
  onPlatformTabChange,
  children,
}: BoundedShellProps) {
  const activePath =
    pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/auth');
  const requestedSurface = resolveSurfaceFromPath(activePath);

  // Scenario 1 (US-23): Sin sesión activa, solo se expone la superficie centrada /auth
  // sin renderizar ningún enlace o navegación de /tenant ni /platform.
  if (!session) {
    return (
      <main className="m3-auth-shell" data-testid="auth-surface">
        <header className="m3-auth-header">
          <div className="m3-brand-mark" aria-hidden="true">
            ID
          </div>
          <M3Chip label="Zero-Trust IAM · Material 3" tone="primary" />
          <h1>Identity Service Portal</h1>
          <p>Multi-Tenant SaaS User Registration &amp; Profile Management</p>
        </header>

        <M3Card variant="elevated" className="m3-auth-card" testId="auth-card">
          {children}
        </M3Card>

        <footer className="m3-auth-footer">
          <span>W3C Trace Context Ready · RFC 7636 PKCE · Argon2id</span>
        </footer>
      </main>
    );
  }

  // Scenario 2 (US-23): Bloqueo estricto en /platform para inquilinos comerciales (ADR-0009)
  if (requestedSurface === 'platform' && !isRootSuperadminSession(session)) {
    return (
      <main className="m3-auth-shell" data-testid="platform-guard-blocked">
        <header className="m3-auth-header">
          <M3Chip label={`${session.tenantId} · Acceso Restringido`} tone="neutral" />
          <h1>Identity Service Portal</h1>
        </header>

        <M3Card variant="elevated" className="m3-auth-card">
          <M3AlertBanner
            severity="error"
            title="403 Forbidden — Acceso Denegado (ADR-0009)"
            message={`El inquilino "${session.tenantId}" no posee privilegios Root Tenant. Cambia a un operador Root Tenant (system:superadmin) para acceder a /platform.`}
            testId="platform-access-denied"
          />
          <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end' }}>
            <M3Button
              variant="filled"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.history.pushState({}, '', '/auth');
                  window.dispatchEvent(new PopStateEvent('popstate'));
                }
              }}
            >
              Volver a /auth
            </M3Button>
          </div>
        </M3Card>
      </main>
    );
  }

  // Scenario 3 (US-23): Consola /platform para Root Tenant Superadmin (ADR-0009)
  if (requestedSurface === 'platform') {
    const platformNav: M3NavItem[] = [
      {
        id: 'posture',
        label: 'Postura & Gobernanza',
        shortCode: 'OV',
        href: '/platform#posture',
        icon: RAIL_ICONS.posture,
        active: activePlatformTab === 'posture',
      },
      {
        id: 'vault',
        label: 'Bóveda Criptográfica',
        shortCode: 'KM',
        href: '/platform#vault',
        icon: RAIL_ICONS.vault,
        active: activePlatformTab === 'vault',
      },
      {
        id: 'bindings',
        label: 'Bindings N:M',
        shortCode: 'BN',
        href: '/platform#bindings',
        icon: RAIL_ICONS.bindings,
        active: activePlatformTab === 'bindings',
      },
      {
        id: 'policies',
        label: 'Tenant Policies',
        shortCode: 'PL',
        href: '/platform#policies',
        icon: RAIL_ICONS.policies,
        active: activePlatformTab === 'policies',
      },
      {
        id: 'federation',
        label: 'Proveedores IdP',
        shortCode: 'IDP',
        href: '/platform#federation',
        icon: RAIL_ICONS.bindings,
        active: activePlatformTab === 'federation',
      },
      {
        id: 'audit',
        label: 'Auditoría Forense',
        shortCode: 'AU',
        href: '/platform#audit',
        icon: RAIL_ICONS.audit,
        active: activePlatformTab === 'audit',
      },
      {
        id: 'sre',
        label: 'Observabilidad SRE',
        shortCode: 'OB',
        href: '/platform#observability',
        icon: RAIL_ICONS.sre,
        active: activePlatformTab === 'sre',
      },
    ];

    return (
      <div className="m3-workspace-shell" data-testid="platform-surface">
        <M3NavigationRail
          ariaLabel="Navegación Root Platform Governance"
          items={platformNav}
          onSelect={
            onPlatformTabChange
              ? (id) => onPlatformTabChange(id as PlatformNavTab)
              : undefined
          }
          testId="platform-nav-rail"
        />
        <div className="m3-workspace-body">
          <header className="m3-workspace-topbar">
            <div>
              <h1>Platform Governance Console</h1>
              <span className="m3-workspace-subtitle">Root Tenant Control Plane (ADR-0009)</span>
            </div>
            <M3Chip
              label="system · superadmin"
              tone="primary"
              testId="platform-role-badge"
            />
          </header>
          <main className="m3-workspace-main">
            <M3Card variant="elevated">{children}</M3Card>
          </main>
        </div>
      </div>
    );
  }

  // Consola /tenant con Navigation Rail para inquilino autenticado
  if (requestedSurface === 'tenant') {
    const tenantNav: M3NavItem[] = [
      { id: 'clients', label: 'Clientes M2M', shortCode: 'CL', href: '/tenant', active: true },
      { id: 'rls', label: 'Aislamiento RLS', shortCode: 'RL', href: '/tenant#rls' },
    ];

    return (
      <div className="m3-workspace-shell" data-testid="tenant-surface">
        <M3NavigationRail
          ariaLabel="Navegación Consola de Inquilino"
          items={tenantNav}
          testId="tenant-nav-rail"
        />
        <div className="m3-workspace-body">
          <header className="m3-workspace-topbar">
            <div>
              <h1>Tenant Console</h1>
              <span className="m3-workspace-subtitle">Multi-Tenant Isolation &amp; Client Registry</span>
            </div>
            <M3Chip label={`${session.tenantId} · Tenant`} tone="primary" />
          </header>
          <main className="m3-workspace-main">
            <M3Card variant="elevated">{children}</M3Card>
          </main>
        </div>
      </div>
    );
  }

  // Sesión activa en superficie /auth
  return (
    <main className="m3-auth-shell" data-testid="auth-surface">
      <header className="m3-auth-header">
        <div className="m3-brand-mark" aria-hidden="true">
          ID
        </div>
        <M3Chip label="Zero-Trust IAM · Material 3" tone="primary" />
        <h1>Identity Service Portal</h1>
        <p>Multi-Tenant SaaS User Registration &amp; Profile Management</p>
      </header>

      <M3Card variant="elevated" className="m3-auth-card" testId="auth-card">
        {children}
      </M3Card>

      <footer className="m3-auth-footer">
        <span>W3C Trace Context Ready · RFC 7636 PKCE · Argon2id</span>
      </footer>
    </main>
  );
}
