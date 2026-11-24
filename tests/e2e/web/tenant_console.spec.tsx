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

    const validateCall = ((globalThis as any).fetch as jest.Mock).mock.calls.find(
      (call: unknown[]) => call[0] === '/api/v1/oauth2/clients/validate'
    );
    expect(JSON.parse((validateCall?.[1] as RequestInit).body as string)).toEqual({
      clientId: 'portal-web',
      origin: 'https://portal.angelpixel.io',
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

  it('Scenario 5 (US-28): registers a confidential client, rotates secret showing one-time banner and suspends it', async () => {
    let currentStatus: 'active' | 'suspended' = 'active';
    (globalThis as any).fetch = jest.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/oauth2/clients') {
        return Promise.resolve(
          mockJsonResponse({
            count: 1,
            clients: [
              {
                id: 'client-m2m-28',
                clientId: 'm2m-worker-28',
                clientName: 'Worker US-28',
                clientType: 'confidential',
                clientProfile: 'm2m',
                status: currentStatus,
                allowedOrigins: ['https://worker.acme-corp.com'],
                redirectUris: [],
                allowedGrantTypes: ['client_credentials'],
                scopes: ['identity:read'],
                isActive: currentStatus === 'active',
              },
            ],
          })
        );
      }
      if (url === '/api/v1/clients' && init?.method === 'POST') {
        return Promise.resolve(
          mockJsonResponse(
            {
              id: 'client-new-28',
              clientId: 'new-worker-28',
              clientName: 'New Worker 28',
              clientType: 'confidential',
              clientProfile: 'm2m',
              status: 'active',
              isActive: true,
              clientSecret: 'one_time_created_secret_28',
            },
            201
          )
        );
      }
      if (url === '/api/v1/clients/m2m-worker-28/rotate-secret') {
        return Promise.resolve(
          mockJsonResponse({
            clientId: 'm2m-worker-28',
            clientSecret: 'one_time_rotated_secret_28',
            secretGraceExpiresAt: '2026-11-24T17:30:00.000Z',
          })
        );
      }
      if (url === '/api/v1/clients/m2m-worker-28' && init?.method === 'PATCH') {
        currentStatus = 'suspended';
        return Promise.resolve(mockJsonResponse({ clientId: 'm2m-worker-28', status: 'suspended' }));
      }
      return Promise.resolve(mockJsonResponse({}));
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('rotate-secret-m2m-worker-28')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('rotate-secret-m2m-worker-28'));
    await waitFor(() => {
      expect(screen.getByTestId('client-secret-once-banner')).toHaveTextContent(
        'one_time_rotated_secret_28'
      );
    });

    fireEvent.click(screen.getByTestId('toggle-client-m2m-worker-28'));
    await waitFor(() => {
      expect(screen.getByTestId('toggle-client-m2m-worker-28')).toHaveTextContent('Reactivar');
    });
  });
});
