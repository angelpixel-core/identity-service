/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { App } from '../../../interfaces/web/client/App';

function mockJsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => {
        const map: Record<string, string> = {
          'content-type': 'application/json',
          traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-d91d81ccca879309-01',
          'x-request-id': 'req-us24-01',
        };
        return map[name.toLowerCase()] ?? null;
      },
    },
    json: async () => data,
  };
}

describe('Web UI E2E Spec: US-24 /auth Portal (OIDC, PKCE, Refresh & Federation)', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.pushState({}, '', '/auth');
  });

  it('Scenario 1: defaults to Cuenta tab with RegisterForm for unauthenticated users', () => {
    render(<App />);
    expect(screen.getByRole('tab', { name: 'Cuenta' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Registro de Nuevo Usuario')).toBeInTheDocument();
  });

  it('Scenario 2: fetches live OIDC Discovery and JWKS in OIDC & JWKS tab (US-07)', async () => {
    (globalThis as any).fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('openid-configuration')) {
        return Promise.resolve(
          mockJsonResponse({
            issuer: 'http://localhost:4000',
            authorization_endpoint: 'http://localhost:4000/oauth2/authorize',
          })
        );
      }
      return Promise.resolve(mockJsonResponse({ keys: [{ kid: 'key-rsa-01', alg: 'RS256' }] }));
    });

    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'OIDC & JWKS' }));
    fireEvent.click(screen.getByRole('button', { name: /Consultar Discovery & JWKS/i }));

    await waitFor(() => {
      expect(screen.getByTestId('oidc-discovery-viewer')).toHaveTextContent('http://localhost:4000');
      expect(screen.getByTestId('oidc-jwks-viewer')).toHaveTextContent('key-rsa-01');
    });
  });

  it('Scenario 3: executes PKCE Authorize + Token Exchange, Rotate Refresh and Revoke (US-08 / US-09)', async () => {
    (globalThis as any).fetch = jest.fn().mockImplementation((url: string) => {
      if (url.startsWith('/oauth2/authorize')) {
        return Promise.resolve(mockJsonResponse({ code: 'auth_code_pkce_01' }));
      }
      if (url === '/api/v1/oauth2/token') {
        return Promise.resolve(
          mockJsonResponse({ access_token: 'jwt_pkce_01', refresh_token: 'rt_01' })
        );
      }
      if (url === '/oauth2/refresh') {
        return Promise.resolve(
          mockJsonResponse({ access_token: 'jwt_pkce_02', refresh_token: 'rt_02' })
        );
      }
      return Promise.resolve(mockJsonResponse({ revoked: true }));
    });

    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'PKCE & Sesiones' }));
    fireEvent.click(screen.getByRole('button', { name: /Ejecutar Authorize \+ Token Exchange/i }));

    await waitFor(() => {
      expect(screen.getByTestId('pkce-output-viewer')).toHaveTextContent('rt_01');
    });

    fireEvent.click(screen.getByRole('button', { name: /Rotar Refresh Token/i }));
    await waitFor(() => {
      expect(screen.getByTestId('pkce-output-viewer')).toHaveTextContent('rt_02');
    });

    fireEvent.click(screen.getByRole('button', { name: /Revocar Sesión/i }));
    await waitFor(() => {
      expect(screen.getByTestId('pkce-output-viewer')).toHaveTextContent('"revoked": true');
    });

    expect(
      screen.getByRole('button', { name: /Inicializar Sesión Refresh \(Dev\)/i })
    ).toBeInTheDocument();
  });

  it('Scenario 4: starts Google federation login and persists JIT session on callback (US-10 / US-11)', async () => {
    (globalThis as any).fetch = jest.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/auth/federation/status') {
        return Promise.resolve(
          mockJsonResponse({
            environment: 'development',
            providers: {
              google: { configured: false, mode: 'dev_emulator', envVar: 'GOOGLE_CLIENT_ID' },
              microsoft: { configured: false, mode: 'dev_emulator', envVar: 'MICROSOFT_CLIENT_ID' },
            },
          })
        );
      }
      if (url.includes('/federation/google/login')) {
        return Promise.resolve(
          mockJsonResponse({
            authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=state_google_01',
            state: 'state_google_01',
          })
        );
      }
      if (url.includes('/federation/google/callback')) {
        return Promise.resolve(
          mockJsonResponse({
            accessToken: 'fed_jwt_01',
            userId: 'usr_fed_01',
            email: 'fed@acme-corp.com',
            tenantId: 'acme-corp',
          })
        );
      }
      return Promise.resolve(
        mockJsonResponse({
          userId: 'usr_fed_01',
          email: 'fed@acme-corp.com',
          tenantId: 'acme-corp',
        })
      );
    });

    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Federación' }));
    await waitFor(() => {
      expect(screen.getByTestId('federation-provider-status')).toHaveTextContent(
        'Google OIDC: Emulador Dev (sin GOOGLE_CLIENT_ID)'
      );
      expect(screen.getByTestId('federation-provider-status')).toHaveTextContent(
        'Microsoft Entra ID: Emulador Dev (sin MICROSOFT_CLIENT_ID)'
      );
    });
    fireEvent.click(screen.getByRole('button', { name: /Continuar con Google/i }));

    await waitFor(() => {
      expect(screen.getByTestId('federation-output-viewer')).toHaveTextContent('state_google_01');
    });

    const loginCall = ((globalThis as any).fetch as jest.Mock).mock.calls.find((call: unknown[]) =>
      String(call[0]).includes('/federation/google/login')
    );
    expect(String(loginCall?.[0])).toContain('tenant_id=acme-corp');
    expect(String(loginCall?.[0])).toContain('redirect_uri=');

    fireEvent.click(screen.getByRole('button', { name: /Procesar Callback JIT/i }));

    await waitFor(() => {
      expect(screen.getByText(/fed@acme-corp\.com/)).toBeInTheDocument();
    });
  });
});
