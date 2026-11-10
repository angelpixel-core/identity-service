import { Request, Response } from 'express';
import { FederationController } from '../../../../interfaces/http/rest/v1/federation/federation_controller';
import { GenerateFederatedLoginUrlQueryHandler } from '../../../../src/contexts/identity/application/queries/generate_federated_login_url/handler';
import { ProcessFederatedCallbackCommandHandler } from '../../../../src/contexts/identity/application/commands/process_federated_callback/handler';

describe('Unit: FederationController (HTTP Interface)', () => {
  let mockLoginHandler: jest.Mocked<GenerateFederatedLoginUrlQueryHandler>;
  let mockCallbackHandler: jest.Mocked<ProcessFederatedCallbackCommandHandler>;
  let controller: FederationController;
  let req: Partial<Request>;
  let res: Partial<Response>;
  let statusMock: jest.Mock;
  let jsonMock: jest.Mock;
  let redirectMock: jest.Mock;

  beforeEach(() => {
    mockLoginHandler = {
      execute: jest.fn(),
    } as any;

    mockCallbackHandler = {
      execute: jest.fn(),
    } as any;

    controller = new FederationController(mockLoginHandler, mockCallbackHandler);

    statusMock = jest.fn().mockReturnThis();
    jsonMock = jest.fn();
    redirectMock = jest.fn();

    res = {
      status: statusMock,
      json: jsonMock,
      redirect: redirectMock,
    };
  });

  describe('login', () => {
    it('should reject with 400 when provider is unsupported', async () => {
      req = {
        params: { provider: 'facebook' },
        query: { tenant_id: 't-1', redirect_uri: 'https://app.io/cb' },
        headers: {},
      };

      await controller.login(req as Request, res as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'invalid_request',
          error_description: expect.stringContaining('Unsupported identity provider: "facebook"'),
        })
      );
    });

    it('should reject with 400 when required query parameters are missing', async () => {
      req = {
        params: { provider: 'google' },
        query: { tenant_id: '' },
        headers: {},
      };

      await controller.login(req as Request, res as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'invalid_request',
        })
      );
    });

    it('should redirect 302 to generated URL by default', async () => {
      req = {
        params: { provider: 'google' },
        query: {
          tenant_id: 'tenant-1',
          redirect_uri: 'https://app.io/cb',
          client_id: 'spa-1',
        },
        headers: {},
      };

      mockLoginHandler.execute.mockResolvedValueOnce({
        url: 'https://accounts.google.com/auth?test=1',
        state: 'st-1',
        nonce: 'nc-1',
      });

      await controller.login(req as Request, res as Response);

      expect(mockLoginHandler.execute).toHaveBeenCalledWith({
        provider: 'google',
        tenantId: 'tenant-1',
        clientId: 'spa-1',
        redirectUri: 'https://app.io/cb',
        prompt: undefined,
        loginHint: undefined,
      });
      expect(redirectMock).toHaveBeenCalledWith(302, 'https://accounts.google.com/auth?test=1');
    });

    it('should return 200 JSON when format=json query parameter is present', async () => {
      req = {
        params: { provider: 'microsoft' },
        query: {
          tenant_id: 'tenant-1',
          redirect_uri: 'https://app.io/cb',
          format: 'json',
        },
        headers: {},
      };

      mockLoginHandler.execute.mockResolvedValueOnce({
        url: 'https://login.microsoftonline.com/auth',
        state: 'st-msft',
        nonce: 'nc-msft',
      });

      await controller.login(req as Request, res as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({
        url: 'https://login.microsoftonline.com/auth',
        state: 'st-msft',
        nonce: 'nc-msft',
      });
    });
  });

  describe('callback', () => {
    it('should reject with 400 when missing code or state', async () => {
      req = {
        params: { provider: 'google' },
        query: { code: 'code-1' }, // missing state
        headers: {},
      };

      await controller.callback(req as Request, res as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'invalid_request',
        })
      );
    });

    it('should successfully call processCallbackHandler and return 200 JSON', async () => {
      req = {
        params: { provider: 'google' },
        query: { code: 'code-123', state: 'state-123' },
        headers: {},
      };

      mockCallbackHandler.execute.mockResolvedValueOnce({
        userProfile: {
          provider: 'google',
          externalSubjectId: 'sub-1',
          email: 'user@acme.com',
          emailVerified: true,
        },
        statePayload: {
          tenantId: 'tenant-1',
          clientId: 'client-1',
          redirectUri: 'https://app.io/cb',
          provider: 'google',
          nonce: 'nonce-1',
          createdAt: 1000,
          expiresAt: 2000,
        },
      });

      await controller.callback(req as Request, res as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({
        status: 'success',
        userProfile: {
          provider: 'google',
          externalSubjectId: 'sub-1',
          email: 'user@acme.com',
          emailVerified: true,
        },
        statePayload: {
          tenantId: 'tenant-1',
          clientId: 'client-1',
          redirectUri: 'https://app.io/cb',
          provider: 'google',
        },
      });
    });

    it('should map Anti-CSRF state errors to 400 invalid_request', async () => {
      req = {
        params: { provider: 'google' },
        query: { code: 'code-123', state: 'bad-state' },
        headers: {},
      };

      mockCallbackHandler.execute.mockRejectedValueOnce(
        new Error('Anti-CSRF state verification failed')
      );

      await controller.callback(req as Request, res as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Anti-CSRF state verification failed',
      });
    });

    it('should map grant / unverified email errors to 401 invalid_grant', async () => {
      req = {
        params: { provider: 'google' },
        query: { code: 'code-123', state: 'valid-state' },
        headers: {},
      };

      mockCallbackHandler.execute.mockRejectedValueOnce(
        new Error('Google account email is not verified')
      );

      await controller.callback(req as Request, res as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'invalid_grant',
        error_description: 'Google account email is not verified',
      });
    });
  });
});
