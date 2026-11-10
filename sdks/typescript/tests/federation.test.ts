import { FederationResource } from '../src/resources/federation_resource';
import { HttpTransport } from '../src/types/common';

describe('SDK Resource: FederationResource (US-10)', () => {
  let mockTransport: HttpTransport;
  let getMock: jest.Mock;

  beforeEach(() => {
    getMock = jest.fn();
    mockTransport = {
      get: getMock,
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    };
  });

  it('should fetch login URL and state for Google provider', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        url: 'https://accounts.google.com/o/oauth2/v2/auth?state=xyz',
        state: 'xyz',
        nonce: 'nonce123',
      },
    });

    const resource = new FederationResource(mockTransport);
    const result = await resource.getLoginUrl('google', {
      tenantId: 'acme-tenant',
      redirectUri: 'https://acme.local/cb',
      clientId: 'spa-client',
      prompt: 'consent',
    });

    expect(result.url).toContain('accounts.google.com');
    expect(result.state).toBe('xyz');
    expect(getMock).toHaveBeenCalledWith(
      '/api/v1/auth/federation/google/login?tenant_id=acme-tenant&redirect_uri=https%3A%2F%2Facme.local%2Fcb&format=json&client_id=spa-client&prompt=consent',
      undefined
    );
  });

  it('should process callback response and verify user profile', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        status: 'success',
        tokens: {
          access_token: 'rs256-mock-token',
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: 'mock-refresh-token',
        },
        user: {
          id: 'user-uuid-1',
          email: 'user@corp.com',
          tenantId: 'corp-tenant',
        },
        isNewUser: false,
        linked: true,
        userProfile: {
          provider: 'microsoft',
          externalSubjectId: 'msft-oid-1',
          email: 'user@corp.com',
          emailVerified: true,
        },
        statePayload: {
          tenantId: 'corp-tenant',
          redirectUri: 'https://corp.local/cb',
          provider: 'microsoft',
        },
      },
    });

    const resource = new FederationResource(mockTransport);
    const result = await resource.processCallback('microsoft', {
      code: 'code-123',
      state: 'state-456',
    });

    expect(result.status).toBe('success');
    expect(result.userProfile.email).toBe('user@corp.com');
    expect(result.tokens?.access_token).toBe('rs256-mock-token');
    expect(result.user?.id).toBe('user-uuid-1');
    expect(result.isNewUser).toBe(false);
    expect(result.linked).toBe(true);
    expect(getMock).toHaveBeenCalledWith(
      '/api/v1/auth/federation/microsoft/callback?code=code-123&state=state-456',
      undefined
    );
  });
});
