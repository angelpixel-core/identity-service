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
          'x-request-id': 'req-us25-01',
        };
        return map[name.toLowerCase()] ?? null;
      },
    },
    json: async () => data,
  };
}

describe('Web UI E2E Spec: US-25 /tenant Console (Clients, M2M & RLS Lab)', () => {
  beforeEach(() => {
    localStorage.setItem(
      'identity_session',
      JSON.stringify({
        token: 'jwt_acme_admin_01',
        userId: 'usr_acme_01',
        email: 'admin@acme-corp.com',
        tenantId: 'acme-corp',
        roles: ['member'],
      })
    );
    window.history.pushState({}, '', '/tenant');
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('Scenario 1 & 2: lists real OAuth2 clients without secret hashes and validates CORS origin (US-03)', async () => {
    (globalThis as any).fetch = jest.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/oauth2/clients') {
        return Promise.resolve(
          mockJsonResponse({
            count: 1,
            clients: [
              {
                id: 'client-seed-1',
                clientId: 'portal-web',
                clientName: 'AngelPixel Web Portal',
                clientType: 'public',
                allowedOrigins: ['https://portal.angelpixel.io'],
                redirectUris: ['https://portal.angelpixel.io/callback'],
                allowedGrantTypes: ['authorization_code'],
                scopes: ['openid', 'profile'],
                isActive: true,
              },
            ],
          })
        );
      }
      return Promise.resolve(
        mockJsonResponse({ authorized: true, clientId: 'portal-web', clientType: 'public' })
      );
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('client-registry-list')).toHaveTextContent('AngelPixel Web Portal');
      expect(screen.getByTestId('client-registry-list')).not.toHaveTextContent('clientSecretHash');
    });

    fireEvent.click(screen.getByRole('button', { name: /Validar Origen CORS/i }));

    await waitFor(() => {
      expect(screen.getByTestId('cors-validation-viewer')).toHaveTextContent('"authorized": true');
    });
  });

  it('Scenario 3: issues M2M client_credentials token in M2M Playground (US-04)', async () => {
    (globalThis as any).fetch = jest.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/oauth2/clients') {
        return Promise.resolve(mockJsonResponse({ count: 0, clients: [] }));
      }
      return Promise.resolve(
        mockJsonResponse({
          access_token: 'm2m_jwt_token_01',
          token_type: 'Bearer',
          scope: 'identity:read',
        })
      );
    });

    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'M2M Playground' }));
    fireEvent.click(screen.getByRole('button', { name: /Solicitar Token M2M/i }));

    await waitFor(() => {
      expect(screen.getByTestId('m2m-output-viewer')).toHaveTextContent('m2m_jwt_token_01');
    });
  });

  it('Scenario 4: demonstrates live 403 Forbidden Zero-Trust block in Cross-Tenant RLS Lab (US-05 / US-06)', async () => {
    (globalThis as any).fetch = jest.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/oauth2/clients') {
        return Promise.resolve(mockJsonResponse({ count: 0, clients: [] }));
      }
      return Promise.resolve(
        mockJsonResponse(
          { error: 'Forbidden: Token does not belong to the requested tenant context' },
          403
        )
      );
    });

    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: /Laboratorio RLS/i }));
    fireEvent.click(screen.getByRole('button', { name: /Probar Acceso Cross-Tenant/i }));

    await waitFor(() => {
      expect(screen.getByTestId('cross-tenant-blocked-banner')).toHaveTextContent(/403 Forbidden/i);
      expect(screen.getByTestId('rls-lab-viewer')).toHaveTextContent('beta-corp');
    });
  });
});
