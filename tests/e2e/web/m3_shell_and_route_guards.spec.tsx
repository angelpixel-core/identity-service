/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { App } from '../../../interfaces/web/client/App';
import {
  M3JsonViewer,
  M3TextField,
} from '../../../interfaces/web/client/design-system/components/M3Primitives';
import { apiRequest } from '../../../interfaces/web/client/shared/api_client';

describe('Web UI E2E Spec: US-23 Material Design 3 Shell & Bounded Contexts', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('Scenario 1: renders centered Material Design 3 /auth surface for unauthenticated users without exposing /tenant or /platform navigation', () => {
    window.history.pushState({}, '', '/auth');

    render(<App />);

    expect(screen.getByTestId('auth-surface')).toBeInTheDocument();
    expect(screen.getByTestId('auth-card')).toBeInTheDocument();
    expect(screen.getByText('Identity Service Portal')).toBeInTheDocument();
    expect(screen.getByText('Registro de Nuevo Usuario')).toBeInTheDocument();

    // Must not expose /tenant or /platform navigation links when unauthenticated
    expect(screen.queryByRole('link', { name: /tenant/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /platform/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('tenant-surface')).not.toBeInTheDocument();
    expect(screen.queryByTestId('platform-surface')).not.toBeInTheDocument();
  });

  it('Scenario 2: blocks /platform with 403 Forbidden M3 banner for commercial tenant users (acme-corp)', () => {
    localStorage.setItem(
      'identity_session',
      JSON.stringify({
        token: 'mock-commercial-jwt',
        userId: 'usr_acme_01',
        email: 'member@acme-corp.com',
        tenantId: 'acme-corp',
        roles: ['member'],
      })
    );
    window.history.pushState({}, '', '/platform');

    render(<App />);

    const deniedBanner = screen.getByTestId('platform-access-denied');
    expect(deniedBanner).toBeInTheDocument();
    expect(deniedBanner).toHaveTextContent(/403 Forbidden/i);
    expect(deniedBanner).toHaveTextContent(/system:superadmin/i);
    expect(screen.queryByTestId('platform-surface')).not.toBeInTheDocument();
  });

  it('Scenario 3: renders /platform workspace with Navigation Rail and system · superadmin badge for Root Superadmin (ADR-0009)', () => {
    localStorage.setItem(
      'identity_session',
      JSON.stringify({
        token: 'mock-root-jwt',
        userId: 'usr_root_01',
        email: 'secadmin@angelpixel.io',
        tenantId: 'system',
        roles: ['superadmin', 'member'],
      })
    );
    window.history.pushState({}, '', '/platform');

    render(<App />);

    expect(screen.getByTestId('platform-surface')).toBeInTheDocument();
    expect(screen.getByTestId('platform-nav-rail')).toBeInTheDocument();
    const roleBadge = screen.getByTestId('platform-role-badge');
    expect(roleBadge).toHaveTextContent('system · superadmin');
    expect(screen.queryByTestId('platform-access-denied')).not.toBeInTheDocument();
  });

  it('Scenario 4: renders M3TextField validation, M3JsonViewer, and propagates W3C trace headers in apiRequest', async () => {
    render(
      <div>
        <M3TextField
          id="tenant-input"
          label="Tenant ID"
          errorText="Tenant inválido"
        />
        <M3JsonViewer
          title="Audit Sample"
          badge="W3C"
          data={{ ok: true }}
          testId="json-viewer"
        />
      </div>
    );

    expect(screen.getByLabelText('Tenant ID')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Tenant inválido');
    expect(screen.getByTestId('json-viewer')).toHaveTextContent('"ok": true');

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => {
          const map: Record<string, string> = {
            'content-type': 'application/json',
            traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-d91d81ccca879309-01',
            'x-request-id': 'req-ui-01',
            'x-correlation-id': 'corr-ui-01',
          };
          return map[name.toLowerCase()] ?? null;
        },
      },
      json: async () => ({ status: 'UP' }),
    });
    (globalThis as any).fetch = mockFetch;

    const res = await apiRequest<{ status: string }>('/health/live', {
      requestId: 'req-ui-01',
      tenantId: 'system',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/health/live',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Request-ID': 'req-ui-01',
          'X-Tenant-ID': 'system',
        }),
      })
    );
    expect(res.trace.traceparent).toBe('00-4bf92f3577b34da6a3ce929d0e0e4736-d91d81ccca879309-01');
    expect(res.trace.requestId).toBe('req-ui-01');
  });
});
