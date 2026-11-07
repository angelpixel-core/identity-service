import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import {
  ClientAuthorizationGuard,
  ClientValidationResponse,
} from './client_authorization_guard';

const meta: Meta<typeof ClientAuthorizationGuard> = {
  title: 'Identity/ClientAuthorizationGuard',
  component: ClientAuthorizationGuard,
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof ClientAuthorizationGuard>;

const ProtectedPortalPreview = () => (
  <div
    data-testid="protected-app"
    style={{
      padding: '1.5rem',
      borderRadius: '0.75rem',
      border: '1px solid #10b981',
      backgroundColor: '#ecfdf5',
      color: '#065f46',
      maxWidth: '420px',
    }}
  >
    <h3 style={{ margin: '0 0 0.5rem 0' }}>Origin & Client Verified</h3>
    <p style={{ margin: 0, fontSize: '0.9rem' }}>
      Client <strong>portal-web</strong> is active and authorized for origin{' '}
      <code>https://portal.angelsolutions.io</code>.
    </p>
  </div>
);

export const AuthorizedPublicClient: Story = {
  args: {
    clientId: 'portal-web',
    currentOrigin: 'https://portal.angelsolutions.io',
    apiClient: {
      validateOrigin: async () => ({
        authorized: true,
        clientId: 'portal-web',
        clientType: 'public',
      }),
    },
    children: <ProtectedPortalPreview />,
  },
};

export const UnauthorizedOriginError: Story = {
  args: {
    clientId: 'portal-web',
    currentOrigin: 'https://malicious-phishing.org',
    apiClient: {
      validateOrigin: async () => {
        throw {
          status: 403,
          errorCode: 'unauthorized_client_origin',
          message:
            'Origin https://malicious-phishing.org is not authorized for client portal-web.',
        };
      },
    },
    children: <ProtectedPortalPreview />,
  },
};

export const DeactivatedClientError: Story = {
  args: {
    clientId: 'legacy-app',
    currentOrigin: 'https://legacy.angelsolutions.io',
    apiClient: {
      validateOrigin: async () => {
        throw {
          status: 401,
          errorCode: 'client_deactivated',
          message: 'Client application "legacy-app" is currently deactivated.',
        };
      },
    },
    children: <ProtectedPortalPreview />,
  },
};

export const VerifyingLoadingState: Story = {
  args: {
    clientId: 'portal-web',
    currentOrigin: 'https://portal.angelsolutions.io',
    apiClient: {
      validateOrigin: () => new Promise<ClientValidationResponse>(() => {}),
    },
    children: <ProtectedPortalPreview />,
  },
};

export const NetworkErrorWithRetry: Story = {
  args: {
    clientId: 'portal-web',
    currentOrigin: 'https://portal.angelsolutions.io',
    apiClient: {
      validateOrigin: async () => {
        throw {
          status: 503,
          errorCode: 'network_connection_error',
          message:
            'Unable to reach Identity Provider (/api/v1/oauth2/clients/validate). Please verify network connectivity and retry.',
        };
      },
    },
    children: <ProtectedPortalPreview />,
  },
};

