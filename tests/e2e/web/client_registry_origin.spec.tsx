/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// Pending client contract / component to be closed in Fase 2
import { ClientAuthorizationGuard } from '../../../interfaces/web/client/contexts/identity/ui/components/client_authorization_guard';

describe('Web UI E2E Spec: Client Registry & Origin Validation Guard', () => {
  it('should render children content when origin and client_id are authorized', async () => {
    const mockApiClient = {
      validateOrigin: jest.fn().mockResolvedValue({
        authorized: true,
        clientId: 'portal-web',
        clientType: 'public',
      }),
    };

    render(
      <ClientAuthorizationGuard
        clientId="portal-web"
        currentOrigin="https://portal.angelpixel.io"
        apiClient={mockApiClient}
      >
        <div data-testid="protected-app">Portal Content Active</div>
      </ClientAuthorizationGuard>
    );

    await waitFor(() => {
      expect(screen.getByTestId('protected-app')).toBeInTheDocument();
      expect(screen.getByText('Portal Content Active')).toBeInTheDocument();
    });
  });

  it('should display origin rejection screen when origin is not in registered allowed_origins', async () => {
    const mockApiClient = {
      validateOrigin: jest.fn().mockRejectedValue({
        status: 403,
        errorCode: 'unauthorized_client_origin',
        message: 'Origin https://malicious-site.com is not authorized for client portal-web',
      }),
    };

    render(
      <ClientAuthorizationGuard
        clientId="portal-web"
        currentOrigin="https://malicious-site.com"
        apiClient={mockApiClient}
      >
        <div data-testid="protected-app">Portal Content Active</div>
      </ClientAuthorizationGuard>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('protected-app')).not.toBeInTheDocument();
      expect(screen.getByText(/unauthorized_client_origin/i)).toBeInTheDocument();
      expect(screen.getByText(/not authorized for client/i)).toBeInTheDocument();
    });
  });

  it('should display deactivated client screen when client is inactive', async () => {
    const mockApiClient = {
      validateOrigin: jest.fn().mockRejectedValue({
        status: 401,
        errorCode: 'client_deactivated',
        message: 'Client legacy-app is currently deactivated',
      }),
    };

    render(
      <ClientAuthorizationGuard
        clientId="legacy-app"
        currentOrigin="https://legacy.angelpixel.io"
        apiClient={mockApiClient}
      >
        <div data-testid="protected-app">Portal Content Active</div>
      </ClientAuthorizationGuard>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('protected-app')).not.toBeInTheDocument();
      expect(screen.getByText(/client_deactivated/i)).toBeInTheDocument();
    });
  });
});