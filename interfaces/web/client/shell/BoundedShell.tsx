import React from 'react';
import { AuthSession } from '../contexts/identity/domain/types';
import {
  M3AlertBanner,
  M3Button,
  M3Card,
  M3Chip,
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

export interface BoundedShellProps {
  session: AuthSession | null;
  pathname?: string;
  children: React.ReactNode;
}

/**
 * BoundedShell (US-23):
 * Separa estrictamente las superficies de UI por Bounded Context:
 * - /auth: Portal centrado estilo Google Account (sin menús administrativos).
 * - /tenant: Consola de inquilino (requiere sesión activa).
 * - /platform: Consola Root Governance (requiere system:superadmin, ADR-0009).
 */
export function BoundedShell({ session, pathname, children }: BoundedShellProps) {
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

  // Sesión activa en superficie /auth (escenarios siguientes ampliarán /tenant y /platform)
  return (
    <main
      className="m3-auth-shell"
      data-testid={`${requestedSurface}-surface`}
    >
      <header className="m3-auth-header">
        <M3Chip label={`${session.tenantId}`} tone="primary" />
        <h1>Identity Service Portal</h1>
        <p>Multi-Tenant SaaS User Registration &amp; Profile Management</p>
      </header>

      <M3Card variant="elevated" className="m3-auth-card">
        {children}
      </M3Card>
    </main>
  );
}
