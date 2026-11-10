import { Request, Response, NextFunction } from 'express';
import { OAuth2SessionController } from '../../../../interfaces/http/rest/v1/oauth2/session_controller';
import { RotateRefreshTokenCommandHandler } from '../../../../src/contexts/identity/application/commands/rotate_refresh_token/handler';
import { RevokeSessionCommandHandler } from '../../../../src/contexts/identity/application/commands/revoke_session/handler';
import { OAuth2AuthenticationError } from '../../../../src/contexts/identity/domain/exceptions/oauth2/error';

describe('HTTP Interface: OAuth2SessionController', () => {
  let mockRotateHandler: jest.Mocked<RotateRefreshTokenCommandHandler>;
  let mockRevokeHandler: jest.Mocked<RevokeSessionCommandHandler>;
  let controller: OAuth2SessionController;
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    mockRotateHandler = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<RotateRefreshTokenCommandHandler>;

    mockRevokeHandler = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<RevokeSessionCommandHandler>;

    controller = new OAuth2SessionController(mockRotateHandler, mockRevokeHandler);

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      cookie: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe('refresh endpoint', () => {
    it('should extract refresh_token from cookies, execute rotate, set cookie, and return 200 JSON', async () => {
      req = {
        cookies: { refresh_token: 'valid_cookie_rt_token_12345' },
        body: {},
        headers: {},
        socket: {} as any,
        originalUrl: '/oauth2/refresh',
      };

      mockRotateHandler.execute.mockResolvedValueOnce({
        access_token: 'new-access-token-jwt',
        token_type: 'Bearer',
        expires_in: 900,
        new_refresh_token: 'new-plain-rt-token',
        family_id: 'fam-1',
        user_id: 'usr-1',
        tenant_id: 'tenant-1',
      });

      await controller.refresh(req as Request, res as Response, next);

      expect(mockRotateHandler.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          refreshToken: 'valid_cookie_rt_token_12345',
        })
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'new-plain-rt-token',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'strict',
          path: '/oauth2',
        })
      );
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          access_token: 'new-access-token-jwt',
          token_type: 'Bearer',
          expires_in: 900,
        })
      );
    });

    it('should reject with 400 invalid_request when no token is present in cookie or body', async () => {
      req = {
        cookies: {},
        body: {},
        headers: {},
        socket: {} as any,
      };

      await controller.refresh(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Missing refresh_token parameter or HttpOnly cookie',
      });
      expect(mockRotateHandler.execute).not.toHaveBeenCalled();
    });

    it('should handle OAuth2AuthenticationError from handler and return error status and description', async () => {
      req = {
        body: { refresh_token: 'some_body_token_string_123' },
        headers: {},
        socket: {} as any,
      };

      mockRotateHandler.execute.mockRejectedValueOnce(
        new OAuth2AuthenticationError('invalid_grant', 'Token has expired', 401)
      );

      await controller.refresh(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_grant',
        error_description: 'Token has expired',
      });
    });
  });

  describe('revoke endpoint', () => {
    it('should extract token, call revokeHandler, clear cookie with maxAge 0, and return 200', async () => {
      req = {
        cookies: { refresh_token: 'token_to_revoke_12345' },
        body: { reason: 'user_logout' },
        headers: {},
        socket: {} as any,
        originalUrl: '/api/v1/oauth2/revoke',
      };

      mockRevokeHandler.execute.mockResolvedValueOnce();

      await controller.revoke(req as Request, res as Response, next);

      expect(mockRevokeHandler.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          refreshToken: 'token_to_revoke_12345',
          reason: 'user_logout',
        })
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        '',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'strict',
          path: '/api/v1/oauth2',
          maxAge: 0,
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Session revoked successfully',
      });
    });
  });
});

