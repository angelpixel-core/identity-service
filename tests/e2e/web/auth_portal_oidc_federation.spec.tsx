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
    expect(screen.getByRole('button', { name: 'Flujo de Identidad' })).toHaveTextContent('Cuenta');
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
    fireEvent.click(screen.getByRole('button', { name: 'Flujo de Identidad' }));
    fireEvent.click(screen.getByRole('button', { name: 'OIDC & JWKS' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Flujo de Identidad' }));
    fireEvent.click(screen.getByRole('button', { name: 'PKCE & Sesiones' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Flujo de Identidad' }));
    fireEvent.click(screen.getByRole('button', { name: 'Federación' }));
    await waitFor(() => {
      expect(screen.getByTestId('federation-status-google')).toHaveAttribute(
        'aria-label',
        'Google OIDC: Emulador Dev (sin GOOGLE_CLIENT_ID)'
      );
      expect(screen.getByTestId('federation-status-microsoft')).toHaveAttribute(
        'aria-label',
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

  it('Scenario 5 (US-32): renders required phone field and KYC notice from /api/v1/auth/config', async () => {
    window.history.pushState({}, '', '/auth?client_id=ecommerce-saas&tenant_id=tusherramientas-a');

    (globalThis as any).fetch = jest.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/v1/auth/config')) {
        return Promise.resolve(
          mockJsonResponse({
            tenantId: 'tusherramientas-a',
            clientId: 'ecommerce-saas',
            requiredFields: ['email', 'password', 'phone'],
            allowedAuthMethods: { password: true, passkeys: false, federatedOidc: true },
            federatedProviders: [{ id: 'google', displayName: 'Google', protocol: 'oidc' }],
            kycRequired: true,
            kycMinLevel: 'biometric_liveness',
          })
        );
      }
      return Promise.resolve(mockJsonResponse({}));
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('register-phone-input')).toBeInTheDocument();
      expect(screen.getByTestId('register-kyc-notice')).toHaveTextContent('biometric_liveness');
    });
  });

  it('Scenario 6 (US-32): disables password onboarding when allowedAuthMethods.password is false', async () => {
    window.history.pushState({}, '', '/auth?client_id=ecommerce-saas&tenant_id=sso-only-corp');

    (globalThis as any).fetch = jest.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/v1/auth/config')) {
        return Promise.resolve(
          mockJsonResponse({
            tenantId: 'sso-only-corp',
            clientId: 'ecommerce-saas',
            requiredFields: ['email', 'password'],
            allowedAuthMethods: { password: false, passkeys: false, federatedOidc: true },
            federatedProviders: [{ id: 'google', displayName: 'Google', protocol: 'oidc' }],
            kycRequired: false,
            kycMinLevel: 'basic',
          })
        );
      }
      return Promise.resolve(mockJsonResponse({}));
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('auth-password-disabled-banner')).toBeInTheDocument();
    });
  });

  it('Scenario 7 (US-35): registers and lists a Passkey in /auth -> Cuenta when authenticated', async () => {
    localStorage.setItem(
      'identity_session',
      JSON.stringify({
        token: 'jwt_passkey_user_01',
        userId: '11111111-1111-4111-8111-111111111111',
        email: 'alice@acme-corp.com',
        tenantId: 'acme-corp',
        roles: ['member'],
      })
    );
    window.history.pushState({}, '', '/auth');

    let passkeysList: any[] = [];
    (globalThis as any).fetch = jest.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/auth/me') {
        return Promise.resolve(
          mockJsonResponse({
            id: '11111111-1111-4111-8111-111111111111',
            email: 'alice@acme-corp.com',
            tenantId: 'acme-corp',
          })
        );
      }
      if (url === '/api/v1/auth/passkeys' && (!init?.method || init.method === 'GET')) {
        return Promise.resolve(mockJsonResponse({ count: passkeysList.length, passkeys: passkeysList }));
      }
      if (url === '/api/v1/auth/passkeys/register/options') {
        return Promise.resolve(
          mockJsonResponse({
            challenge: 'dGVzdC1jaGFsbGVuZ2U',
            rp: { name: 'Identity', id: 'localhost' },
            user: { id: 'dXNy', name: 'alice@acme-corp.com', displayName: 'alice@acme-corp.com' },
            pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
          })
        );
      }
      if (url === '/api/v1/auth/passkeys/register/verify') {
        const created = {
          id: 'pk-uuid-1',
          credentialId: 'cred-e2e-passkey-01',
          deviceType: 'multiDevice',
          backedUp: true,
          transports: ['internal'],
          createdAt: '2026-11-24T18:55:00.000Z',
        };
        passkeysList = [created];
        return Promise.resolve(mockJsonResponse(created, 201));
      }
      return Promise.resolve(mockJsonResponse({}));
    });

    Object.defineProperty(globalThis.navigator, 'credentials', {
      configurable: true,
      value: {
        create: jest.fn().mockResolvedValue({
          id: 'cred-e2e-passkey-01',
          rawId: new Uint8Array([1, 2, 3]).buffer,
          type: 'public-key',
          response: {
            clientDataJSON: new Uint8Array([4, 5, 6]).buffer,
            attestationObject: new Uint8Array([7, 8, 9]).buffer,
            getTransports: () => ['internal'],
          },
          getClientExtensionResults: () => ({}),
        }),
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('passkeys-panel')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('register-passkey-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('passkeys-success')).toBeInTheDocument();
      expect(screen.getByTestId('passkeys-list')).toHaveTextContent('cred-e2e-passkey');
    });
  });

  it('Scenario 8 (US-36): authenticates passwordless via Passkey in /auth', async () => {
    window.history.pushState({}, '', '/auth?client_id=ecommerce-saas&tenant_id=acme-corp');

    (globalThis as any).fetch = jest.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/v1/auth/config')) {
        return Promise.resolve(
          mockJsonResponse({
            tenantId: 'acme-corp',
            clientId: 'ecommerce-saas',
            requiredFields: ['email', 'password'],
            allowedAuthMethods: { password: false, passkeys: true, federatedOidc: false },
            federatedProviders: [],
            kycRequired: false,
            kycMinLevel: 'basic',
          })
        );
      }
      if (url === '/api/v1/auth/passkeys/login/options') {
        return Promise.resolve(
          mockJsonResponse({
            challenge: 'dGVzdC1hdXRoLWNoYWxsZW5nZQ',
            rpId: 'localhost',
            allowCredentials: [],
          })
        );
      }
      if (url === '/api/v1/auth/passkeys/login/verify') {
        return Promise.resolve(
          mockJsonResponse({
            token: 'jwt_passkey_auth_36',
            userId: '11111111-1111-4111-8111-111111111111',
            email: 'passkey-e2e@acme-corp.com',
            tenantId: 'acme-corp',
            roles: ['member'],
            amr: ['hwk', 'user'],
          })
        );
      }
      if (url === '/api/v1/auth/me') {
        return Promise.resolve(
          mockJsonResponse({
            id: '11111111-1111-4111-8111-111111111111',
            email: 'passkey-e2e@acme-corp.com',
            tenantId: 'acme-corp',
          })
        );
      }
      if (url === '/api/v1/auth/passkeys') {
        return Promise.resolve(mockJsonResponse({ count: 0, passkeys: [] }));
      }
      return Promise.resolve(mockJsonResponse({}));
    });

    Object.defineProperty(globalThis.navigator, 'credentials', {
      configurable: true,
      value: {
        get: jest.fn().mockResolvedValue({
          id: 'cred-e2e-login-01',
          rawId: new Uint8Array([1, 2, 3]).buffer,
          type: 'public-key',
          response: {
            authenticatorData: new Uint8Array([4, 5, 6]).buffer,
            clientDataJSON: new Uint8Array([7, 8, 9]).buffer,
            signature: new Uint8Array([10, 11, 12]).buffer,
          },
          getClientExtensionResults: () => ({}),
        }),
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('passkey-login-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('passkey-login-btn'));

    await waitFor(() => {
      expect(screen.getByText(/passkey-e2e@acme-corp\.com/)).toBeInTheDocument();
    });
  });
});
