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

  it('Scenario 6 (US-30): enforces read-only mode for member and allows save for tenant_admin in /tenant', async () => {
    localStorage.setItem(
      'identity_session',
      JSON.stringify({
        token: 'jwt_member_01',
        userId: 'usr_member_01',
        email: 'member@acme-corp.com',
        tenantId: 'acme-corp',
        roles: ['member'],
      })
    );
    window.history.pushState({}, '', '/tenant');

    let policy = {
      tenantId: 'acme-corp',
      requiredAttributes: { phone: false },
      kycPolicy: { required: false, minLevel: 'basic' },
      allowedAuthMethods: { password: true, passkeys: true, federatedOidc: true },
      updatedAt: '2026-11-24T12:00:00.000Z',
      updatedBy: 'system',
      isDefault: true,
    };

    (globalThis as any).fetch = jest.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/tenants/acme-corp/policy' && (!init?.method || init.method === 'GET')) {
        return Promise.resolve(mockJsonResponse(policy));
      }
      if (url === '/api/v1/tenants/acme-corp/policy' && init?.method === 'PUT') {
        const parsed = JSON.parse(String(init.body ?? '{}'));
        policy = { ...policy, ...parsed, isDefault: false, updatedBy: 'admin@acme-corp.com' };
        return Promise.resolve(mockJsonResponse(policy));
      }
      if (url === '/api/v1/clients') {
        return Promise.resolve(mockJsonResponse({ clients: [] }));
      }
      return Promise.resolve(mockJsonResponse({}));
    });

    const { unmount } = render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: /Política de Identidad/i }));

    await waitFor(() => {
      expect(screen.getByTestId('tenant-policy-readonly-chip')).toHaveTextContent(
        'Solo lectura (rol member)'
      );
      expect(screen.getByTestId('tenant-policy-phone-checkbox')).toBeDisabled();
      expect(screen.queryByTestId('tenant-policy-save-btn')).not.toBeInTheDocument();
    });

    unmount();

    localStorage.setItem(
      'identity_session',
      JSON.stringify({
        token: 'jwt_tenant_admin_01',
        userId: 'usr_admin_01',
        email: 'admin@acme-corp.com',
        tenantId: 'acme-corp',
        roles: ['tenant_admin'],
      })
    );

    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: /Política de Identidad/i }));

    await waitFor(() => {
      expect(screen.getByTestId('tenant-policy-phone-checkbox')).toBeEnabled();
      expect(screen.getByTestId('tenant-policy-save-btn')).toBeEnabled();
    });

    fireEvent.click(screen.getByTestId('tenant-policy-phone-checkbox'));
    fireEvent.click(screen.getByTestId('tenant-policy-save-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('tenant-policy-success')).toBeInTheDocument();
      expect(screen.getByTestId('tenant-policy-origin-chip')).toHaveTextContent('Personalizada');
    });
  });

  it('Scenario 7 (US-31): inspects /api/v1/auth/config with ETag and JSON viewer in TenantPolicyPanel', async () => {
    localStorage.setItem(
      'identity_session',
      JSON.stringify({
        token: 'jwt_tenant_admin_02',
        userId: 'usr_admin_02',
        email: 'admin@acme-corp.com',
        tenantId: 'acme-corp',
        roles: ['tenant_admin'],
      })
    );
    window.history.pushState({}, '', '/tenant');

    (globalThis as any).fetch = jest.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/tenants/acme-corp/policy') {
        return Promise.resolve(
          mockJsonResponse({
            tenantId: 'acme-corp',
            requiredAttributes: { phone: false },
            kycPolicy: { required: false, minLevel: 'basic' },
            allowedAuthMethods: { password: true, passkeys: true, federatedOidc: true },
            updatedAt: '2026-11-24T12:00:00.000Z',
            updatedBy: 'system',
            isDefault: true,
          })
        );
      }
      if (url.startsWith('/api/v1/auth/config')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({
            'content-type': 'application/json',
            etag: '"w/us31-etag-001"',
            'cache-control': 'private, max-age=60',
          }),
          json: async () => ({
            tenantId: 'acme-corp',
            clientId: 'portal-web',
            requiredFields: ['email', 'password'],
            allowedAuthMethods: { password: true, passkeys: true, federatedOidc: true },
            kycRequired: false,
            kycMinLevel: 'basic',
          }),
        });
      }
      return Promise.resolve(mockJsonResponse({ clients: [] }));
    });

    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: /Política de Identidad/i }));

    await waitFor(() => {
      expect(screen.getByTestId('public-auth-config-inspect-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('public-auth-config-inspect-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('public-auth-config-etag-chip')).toHaveTextContent('w/us31-etag-001');
      expect(screen.getByTestId('public-auth-config-json-viewer')).toHaveTextContent('portal-web');
    });
  });

  it('Scenario 8 (US-33): enforces read-only for member and registers/removes IdP for tenant_admin', async () => {
    localStorage.setItem(
      'identity_session',
      JSON.stringify({
        token: 'jwt_member_02',
        userId: 'usr_member_02',
        email: 'member@acme-corp.com',
        tenantId: 'acme-corp',
        roles: ['member'],
      })
    );
    window.history.pushState({}, '', '/tenant');

    let providers: Array<Record<string, unknown>> = [];

    (globalThis as any).fetch = jest.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/tenants/acme-corp/federation/providers' && (!init?.method || init.method === 'GET')) {
        return Promise.resolve(mockJsonResponse({ tenantId: 'acme-corp', count: providers.length, providers }));
      }
      if (url === '/api/v1/tenants/acme-corp/federation/providers' && init?.method === 'POST') {
        const parsed = JSON.parse(String(init.body ?? '{}'));
        const item = {
          id: 'idp-e2e-01',
          tenantId: 'acme-corp',
          providerKey: parsed.providerKey,
          displayName: parsed.displayName,
          protocol: parsed.protocol ?? 'oidc',
          issuerUrl: parsed.issuerUrl,
          clientId: parsed.clientId,
          hasClientSecret: true,
          scopes: parsed.scopes ?? ['openid', 'email', 'profile'],
          enabled: true,
        };
        providers = [item];
        return Promise.resolve(mockJsonResponse(item, 201));
      }
      if (url === '/api/v1/tenants/acme-corp/federation/providers/okta-corp' && init?.method === 'DELETE') {
        providers = [];
        return Promise.resolve(mockJsonResponse({ removed: true, providerKey: 'okta-corp' }));
      }
      return Promise.resolve(mockJsonResponse({ clients: [] }));
    });

    const { unmount } = render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: /Proveedores IdP/i }));

    await waitFor(() => {
      expect(screen.getByTestId('idp-readonly-banner')).toBeInTheDocument();
      expect(screen.queryByTestId('idp-register-submit')).not.toBeInTheDocument();
    });

    unmount();

    localStorage.setItem(
      'identity_session',
      JSON.stringify({
        token: 'jwt_admin_03',
        userId: 'usr_admin_03',
        email: 'admin@acme-corp.com',
        tenantId: 'acme-corp',
        roles: ['tenant_admin'],
      })
    );

    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: /Proveedores IdP/i }));

    await waitFor(() => {
      expect(screen.getByTestId('idp-register-submit')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Client Secret/i), {
      target: { value: 'okta_e2e_secret_01' },
    });
    fireEvent.click(screen.getByTestId('idp-register-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('idp-success-banner')).toBeInTheDocument();
      expect(screen.getByTestId('idp-providers-list')).toHaveTextContent('Secret: AES-256-GCM (hidden)');
    });

    fireEvent.click(screen.getByTestId('idp-remove-okta-corp'));

    await waitFor(() => {
      expect(screen.getByTestId('idp-providers-list')).toHaveTextContent('Sin proveedores federados personalizados');
    });
  });
});
