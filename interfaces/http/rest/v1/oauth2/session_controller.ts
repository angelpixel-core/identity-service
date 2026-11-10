import { Request, Response, NextFunction } from 'express';
import { RotateRefreshTokenCommandHandler } from '../../../../../src/contexts/identity/application/commands/rotate_refresh_token/handler';
import { RevokeSessionCommandHandler } from '../../../../../src/contexts/identity/application/commands/revoke_session/handler';
import { OAuth2AuthenticationError } from '../../../../../src/contexts/identity/domain/exceptions/oauth2/error';

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'strict' | 'lax' | 'none';
  path: string;
  maxAge: number;
}

/**
 * Controller: OAuth2SessionController
 * Expone los endpoints de ciclo de vida de sesiones y rotación de Refresh Tokens (US-09).
 * - POST /oauth2/refresh & POST /api/v1/oauth2/refresh
 * - POST /oauth2/revoke  & POST /api/v1/oauth2/revoke
 */
export class OAuth2SessionController {
  constructor(
    private readonly rotateHandler: RotateRefreshTokenCommandHandler,
    private readonly revokeHandler: RevokeSessionCommandHandler
  ) {}

  private getCookieOptions(req: Request, maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): CookieOptions {
    const isProduction = process.env.NODE_ENV === 'production';
    // Determinar el path de la cookie según la ruta de acceso (o por defecto a /api/v1/oauth2)
    const isV1 = req.originalUrl?.includes('/api/v1') || req.baseUrl?.includes('/api/v1');
    const path = isV1 ? '/api/v1/oauth2' : '/oauth2';

    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      path,
      maxAge: maxAgeMs,
    };
  }

  public refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Extraer refresh token desde cookies o cuerpo
      const refreshToken =
        (req.cookies && req.cookies.refresh_token) ||
        (req.body && req.body.refresh_token) ||
        '';

      if (!refreshToken) {
        throw new OAuth2AuthenticationError(
          'invalid_request',
          'Missing refresh_token parameter or HttpOnly cookie',
          400
        );
      }

      const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
      const userAgent = req.headers['user-agent'];

      const result = await this.rotateHandler.execute({
        refreshToken,
        clientId: (req.body && req.body.client_id) || undefined,
        ip,
        userAgent,
      });

      // Actualizar la cookie HttpOnly con el nuevo refresh token
      const cookieOpts = this.getCookieOptions(req);
      res.cookie('refresh_token', result.new_refresh_token, cookieOpts);

      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      res.status(200).json({
        access_token: result.access_token,
        token_type: result.token_type,
        expires_in: result.expires_in,
        ...(result.id_token ? { id_token: result.id_token } : {}),
      });
    } catch (error: any) {
      if (error instanceof OAuth2AuthenticationError || (error && typeof error === 'object' && error.errorCode)) {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Pragma', 'no-cache');
        res.status(error.statusCode || 400).json({
          error: error.errorCode,
          error_description: error.errorDescription,
        });
        return;
      }
      next(error);
    }
  };

  public revoke = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const refreshToken =
        (req.cookies && req.cookies.refresh_token) ||
        (req.body && req.body.refresh_token) ||
        '';

      if (refreshToken) {
        const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
        await this.revokeHandler.execute({
          refreshToken,
          ip,
          reason: (req.body && req.body.reason) || 'user_logout',
        });
      }

      // Limpiar la cookie de sesión
      const clearOpts = this.getCookieOptions(req, 0);
      res.cookie('refresh_token', '', clearOpts);

      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      res.status(200).json({
        message: 'Session revoked successfully',
      });
    } catch (error: any) {
      if (error instanceof OAuth2AuthenticationError || (error && typeof error === 'object' && error.errorCode)) {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Pragma', 'no-cache');
        res.status(error.statusCode || 400).json({
          error: error.errorCode,
          error_description: error.errorDescription,
        });
        return;
      }
      next(error);
    }
  };
}

