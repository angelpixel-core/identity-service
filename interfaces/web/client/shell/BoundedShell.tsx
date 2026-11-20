import React from 'react';
import { AuthSession } from '../contexts/identity/domain/types';
import { M3Card, M3Chip } from '../design-system/components/M3Primitives';

export type BoundedSurface = 'auth' | 'tenant' | 'platform';

export function resolveSurfaceFromPath(pathname: string): BoundedSurface {
  const normalized = pathname.toLowerCase();
  if (normalized.startsWith('/platform')) return 'platform';
  if (normalized.startsWith('/tenant')) return 'tenant';
  return 'auth';
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
