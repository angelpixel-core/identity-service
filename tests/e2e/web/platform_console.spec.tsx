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
          traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
          'x-request-id': 'req-us26-01',
        };
        return map[name.toLowerCase()] ?? null;
      },
    },
    json: async () => data,
  };
}

function mockTextResponse(text: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => {
        const map: Record<string, string> = {
          'content-type': 'text/plain; version=0.0.4; charset=utf-8',
          traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        };
        return map[name.toLowerCase()] ?? null;
      },
    },
    text: async () => text,
  };
}

const SAMPLE_POSTURE = {
  status: 'ACTIVE',
  governance: {
    rootTenantId: 'system',
    adr: 'ADR-0009',
    mode: 'READ_ONLY_POSTURE',
    actor: { userId: 'usr_root_01', tenantId: 'system', roles: ['superadmin'] },
  },
  infrastructurePosture: {
    cloudIac: { story: 'US-12', provider: 'Azure / Floci', tlsEndpoint: 'https://localhost:4577', status: 'VERIFIED_PARITY' },
    ingressTls: { story: 'US-13', protocol: 'TLS 1.3', proxyMode: 'NGINX Ingress', status: 'ACTIVE' },
    helmChart: { story: 'US-14', release: 'identity-service', schemaValidation: 'STRICT', networkPolicyZeroTrust: true },
    cicdGuardrails: { story: 'US-15', nonRootUid: 1000, imageTagPolicy: 'IMMUTABLE_SHA', rollbackCircuitBreaker: true },
    networkPolicy: { story: 'US-18', defaultDenyAll: true, allowedIngressPort: 4000, status: 'ENFORCED' },
  },
  securityPosture: {
    rateLimiting: { enabled: true, windowMs: 60000, maxRequestsPerWindow: 100 },
    securityHeaders: { helmetEnabled: true, corsStrict: true, hstsEnabled: false },
    databaseTls: { story: 'US-17', mode: 'DYNAMIC_POSTGRES_POOL', activeGeneration: 2, sslEnabled: true, minVersion: 'TLSv1.2', rejectUnauthorized: true },
  },
  vaultMetadata: {
    story: 'US-16',
    activeKeyId: 'kid_rsa_initial_01',
    jwksKeysCount: 1,
    exposedKids: ['kid_rsa_initial_01'],
    jwksEndpoint: '/.well-known/jwks.json',
  },
  auditSummary: {
    story: 'US-19',
    source: 'IN_PROCESS_SECURITY_AUDIT_RING_BUFFER',
    recentEventsCount: 3,
    bufferCapacity: 500,
    cloudWormRetentionDays: 365,
  },
  observability: {
    w3cTraceContext: { propagatedTraceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01', requestId: 'req-us26-01' },
    endpoints: { metrics: '/metrics', liveness: '/health/live', readiness: '/health/ready' },
    uptimeSeconds: 42,
  },
  timestamp: '2026-11-20T20:00:00.000Z',
};

describe('Web UI E2E Spec: US-26 /platform Console (Governance, Vault, Audit & SRE)', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('Scenario 1: blocks non-superadmin tenant session on /platform with 403 banner (ADR-0009)', () => {
    localStorage.setItem(
      'identity_session',
      JSON.stringify({
        token: 'jwt_acme_user_01',
        userId: 'usr_acme_01',
        email: 'dev@acme-corp.com',
        tenantId: 'acme-corp',
        roles: ['member'],
      })
    );
    window.history.pushState({}, '', '/platform');

    render(<App />);

    expect(screen.getByTestId('platform-access-denied')).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: /Consola de Plataforma Root/i })).not.toBeInTheDocument();
  });

  it('Scenario 2: loads read-only security posture and W3C traceparent for system:superadmin', async () => {
    localStorage.setItem(
      'identity_session',
      JSON.stringify({
        token: 'jwt_root_superadmin_01',
        userId: 'usr_root_01',
        email: 'admin@angelpixel.io',
        tenantId: 'system',
        roles: ['superadmin'],
      })
    );
    window.history.pushState({}, '', '/platform');

    (globalThis as any).fetch = jest.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/platform/posture') {
        return Promise.resolve(mockJsonResponse(SAMPLE_POSTURE));
      }
      return Promise.resolve(mockJsonResponse({}));
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('platform-posture-summary')).toHaveTextContent('READ_ONLY_POSTURE');
      expect(screen.getByTestId('platform-posture-summary')).toHaveTextContent('TLS 1.3');
      expect(screen.getByTestId('posture-traceparent')).toHaveTextContent('00-4bf92f3577b34da6a3ce929d0e0e4736');
    });
  });

  it('Scenario 3: inspects vault metadata and rotates signing key after explicit confirmation (US-16/17)', async () => {
    localStorage.setItem(
      'identity_session',
      JSON.stringify({
        token: 'jwt_root_superadmin_01',
        userId: 'usr_root_01',
        email: 'admin@angelpixel.io',
        tenantId: 'system',
        roles: ['superadmin'],
      })
    );
    window.history.pushState({}, '', '/platform');

    let activeKid = 'kid_rsa_initial_01';
    (globalThis as any).fetch = jest.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/platform/posture') {
        return Promise.resolve(mockJsonResponse(SAMPLE_POSTURE));
      }
      if (url === '/api/v1/secrets/status') {
        return Promise.resolve(
          mockJsonResponse({
            status: 'ACTIVE',
            signingKeys: {
              activeKeyId: activeKid,
              retainedKeysCount: activeKid === 'kid_rsa_initial_01' ? 0 : 1,
              jwksKeysCount: activeKid === 'kid_rsa_initial_01' ? 1 : 2,
              exposedKids: activeKid === 'kid_rsa_initial_01' ? [activeKid] : [activeKid, 'kid_rsa_initial_01'],
              jwksEndpoint: '/.well-known/jwks.json',
            },
            databasePool: { mode: 'DYNAMIC_POSTGRES_POOL', activeGeneration: 2 },
            timestamp: '2026-11-20T20:05:00.000Z',
          })
        );
      }
      if (url === '/api/v1/secrets/rotate-signing-key') {
        activeKid = 'kid_rsa_rotated_2026';
        return Promise.resolve(
          mockJsonResponse({
            status: 'ROTATED',
            previousKeyId: 'kid_rsa_initial_01',
            activeKeyId: activeKid,
          })
        );
      }
      return Promise.resolve(mockJsonResponse({}));
    });

    render(<App />);

    fireEvent.click(screen.getByRole('tab', { name: /Bóveda Criptográfica/i }));

    await waitFor(() => {
      expect(screen.getByTestId('vault-status-summary')).toHaveTextContent('kid_rsa_initial_01');
    });

    const rotateBtn = screen.getByRole('button', { name: /Ejecutar Rotación de Llave/i });
    expect(rotateBtn).toBeDisabled();

    fireEvent.click(screen.getByTestId('confirm-rotation-checkbox'));
    expect(rotateBtn).toBeEnabled();

    fireEvent.click(rotateBtn);

    await waitFor(() => {
      expect(screen.getByTestId('vault-rotation-result')).toHaveTextContent('kid_rsa_rotated_2026');
      expect(screen.getByTestId('vault-status-summary')).toHaveTextContent('kid_rsa_rotated_2026');
    });
  });

  it('Scenario 4 & 5: filters forensic audit events (US-19) and renders SRE probes/metrics (US-20..22)', async () => {
    localStorage.setItem(
      'identity_session',
      JSON.stringify({
        token: 'jwt_root_superadmin_01',
        userId: 'usr_root_01',
        email: 'admin@angelpixel.io',
        tenantId: 'system',
        roles: ['superadmin'],
      })
    );
    window.history.pushState({}, '', '/platform');

    (globalThis as any).fetch = jest.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/platform/posture') {
        return Promise.resolve(mockJsonResponse(SAMPLE_POSTURE));
      }
      if (url.startsWith('/api/v1/audit/events')) {
        return Promise.resolve(
          mockJsonResponse({
            status: 'ACTIVE',
            count: 1,
            events: [
              {
                eventType: 'CROSS_TENANT_VIOLATION',
                severity: 'WARN',
                status: 'DENIED',
                tenantId: 'acme-corp',
                traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
              },
            ],
          })
        );
      }
      if (url === '/health/live') {
        return Promise.resolve(mockJsonResponse({ status: 'UP', probe: 'liveness' }));
      }
      if (url === '/health/ready') {
        return Promise.resolve(mockJsonResponse({ status: 'UP', probe: 'readiness' }));
      }
      if (url === '/metrics') {
        return Promise.resolve(mockTextResponse('# TYPE http_requests_total counter\nhttp_requests_total 12\n'));
      }
      return Promise.resolve(mockJsonResponse({}));
    });

    render(<App />);

    // Scenario 4: Audit Explorer
    fireEvent.click(screen.getByRole('tab', { name: /Auditoría Forense/i }));
    await waitFor(() => {
      expect(screen.getByTestId('audit-events-list')).toHaveTextContent('CROSS_TENANT_VIOLATION');
      expect(screen.getByTestId('audit-events-list')).toHaveTextContent('4bf92f3577b34da6a3ce929d0e0e4736');
    });

    // Scenario 5: SRE Observability
    fireEvent.click(screen.getByRole('tab', { name: /Observabilidad SRE/i }));
    await waitFor(() => {
      expect(screen.getByTestId('sre-observability-summary')).toHaveTextContent('/health/live: HTTP 200');
      expect(screen.getByTestId('sre-observability-summary')).toHaveTextContent('/health/ready: HTTP 200');
      expect(screen.getByTestId('sre-metrics-viewer')).toHaveTextContent('http_requests_total 12');
      expect(screen.getByTestId('sre-traceparent')).toHaveTextContent('00-4bf92f3577b34da6a3ce929d0e0e4736');
    });
  });

  it('Scenario 6 (US-29): manages N:M Client-Tenant bindings in /platform Bindings N:M view', async () => {
    localStorage.setItem(
      'identity_session',
      JSON.stringify({
        token: 'jwt_root_superadmin_01',
        userId: 'usr_root_01',
        email: 'admin@angelpixel.io',
        tenantId: 'system',
        roles: ['superadmin'],
      })
    );
    window.history.pushState({}, '', '/platform');

    let bindingsList: any[] = [];
    (globalThis as any).fetch = jest.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/platform/posture') {
        return Promise.resolve(mockJsonResponse(SAMPLE_POSTURE));
      }
      if (url.endsWith('/bindings') && (!init?.method || init.method === 'GET')) {
        return Promise.resolve(mockJsonResponse({ count: bindingsList.length, bindings: bindingsList }));
      }
      if (url.endsWith('/bindings') && init?.method === 'POST') {
        const created = {
          id: 'bind-29-1',
          clientId: 'portal-web',
          tenantId: 'acme-corp',
          customDomain: 'tienda-a.tusherramientas.com',
          allowedRedirectUris: ['https://tienda-a.tusherramientas.com/callback'],
          allowedCorsOrigins: ['https://tienda-a.tusherramientas.com'],
          isActive: true,
        };
        bindingsList = [created];
        return Promise.resolve(mockJsonResponse(created, 201));
      }
      return Promise.resolve(mockJsonResponse({}));
    });

    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: /Bindings N:M/i }));
    await waitFor(() => {
      expect(screen.getByTestId('platform-bindings-panel')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('create-binding-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('platform-bindings-list')).toHaveTextContent(
        'tienda-a.tusherramientas.com'
      );
    });
  });
});
