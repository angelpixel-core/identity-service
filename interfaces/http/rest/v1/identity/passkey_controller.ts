import { Request, Response, NextFunction } from 'express';
import {
  BeginPasskeyRegistrationCommandHandler,
  ListPasskeysQueryHandler,
  RevokePasskeyCommandHandler,
  VerifyPasskeyRegistrationCommandHandler,
} from '../../../../../src/contexts/identity/application/commands/register_passkey/handler';
import {
  BeginPasskeyAuthenticationCommandHandler,
  VerifyPasskeyAuthenticationCommandHandler,
} from '../../../../../src/contexts/identity/application/commands/authenticate_passkey/handler';
import { OAuth2AuthenticationError } from '../../../../../src/contexts/identity/domain/exceptions/oauth2/error';
import { DomainValidationError } from '../../../../../src/contexts/identity/domain/exceptions/user/error';

function paramStr(val: string | string[] | undefined): string {
  return (Array.isArray(val) ? val[0] : val) ?? '';
}

/**
 * REST Driver Controller: PasskeyController (US-35)
 */
export class PasskeyController {
  constructor(
    private readonly beginRegistrationHandler: BeginPasskeyRegistrationCommandHandler,
    private readonly verifyRegistrationHandler: VerifyPasskeyRegistrationCommandHandler,
    private readonly listPasskeysHandler: ListPasskeysQueryHandler,
    private readonly revokePasskeyHandler: RevokePasskeyCommandHandler,
    private readonly beginAuthenticationHandler?: BeginPasskeyAuthenticationCommandHandler,
    private readonly verifyAuthenticationHandler?: VerifyPasskeyAuthenticationCommandHandler
  ) {}

  private handleError(error: unknown, res: Response, next: NextFunction): void {
    if (error instanceof OAuth2AuthenticationError) {
      res.status(error.statusCode).json({
        error: error.errorCode,
        message: error.errorDescription,
      });
      return;
    }
    if (error instanceof DomainValidationError) {
      const status = (error as Error & { statusCode?: number }).statusCode ?? 400;
      res.status(status).json({
        error: status === 404 ? 'not_found' : 'validation_error',
        message: error.message,
      });
      return;
    }
    next(error);
  }

  public beginRegistration = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.userId || !req.tenantId) {
        res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
        return;
      }

      const body = req.body ?? {};
      const options = await this.beginRegistrationHandler.execute({
        userId: req.userId,
        email: body.email ?? req.userId,
        tenantId: req.tenantId,
        clientId: body.clientId ?? body.client_id,
        origin: (req.headers.origin as string | undefined) || undefined,
        ip: req.ip,
      });

      res.status(200).json(options);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  public verifyRegistration = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.userId || !req.tenantId) {
        res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
        return;
      }

      const body = req.body ?? {};
      const credentialResponse = body.response ?? body.credential ?? body;
      const summary = await this.verifyRegistrationHandler.execute({
        userId: req.userId,
        tenantId: req.tenantId,
        response: credentialResponse,
        clientId: body.clientId ?? body.client_id,
        origin: (req.headers.origin as string | undefined) || undefined,
        ip: req.ip,
      });

      res.status(201).json(summary);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  public listPasskeys = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.userId || !req.tenantId) {
        res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
        return;
      }

      const passkeys = await this.listPasskeysHandler.execute(req.userId, req.tenantId);
      res.status(200).json({ count: passkeys.length, passkeys });
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  public revokePasskey = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.userId || !req.tenantId) {
        res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
        return;
      }

      const id = paramStr(req.params.id);
      await this.revokePasskeyHandler.execute(id, req.userId, req.tenantId);
      res.status(200).json({ revoked: true, id });
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  public beginAuthentication = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!this.beginAuthenticationHandler) {
        res.status(501).json({ error: 'Passkey login not configured' });
        return;
      }

      const tenantId = req.tenantId!;
      const body = req.body ?? {};
      const options = await this.beginAuthenticationHandler.execute({
        tenantId,
        email: typeof body.email === 'string' ? body.email : undefined,
        clientId: body.clientId ?? body.client_id,
        origin: (req.headers.origin as string | undefined) || undefined,
        ip: req.ip,
      });

      res.status(200).json(options);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  public verifyAuthentication = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!this.verifyAuthenticationHandler) {
        res.status(501).json({ error: 'Passkey login not configured' });
        return;
      }

      const tenantId = req.tenantId!;
      const body = req.body ?? {};
      const assertionResponse = body.response ?? body.credential ?? body;
      const result = await this.verifyAuthenticationHandler.execute({
        tenantId,
        response: assertionResponse,
        challenge: typeof body.challenge === 'string' ? body.challenge : undefined,
        clientId: body.clientId ?? body.client_id,
        origin: (req.headers.origin as string | undefined) || undefined,
        ip: req.ip,
      });

      if (result.refreshToken) {
        res.cookie('refresh_token', result.refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/oauth2',
        });
      }

      res.status(200).json({
        token: result.accessToken,
        accessToken: result.accessToken,
        userId: result.userId,
        email: result.email,
        tenantId: result.tenantId,
        roles: result.roles,
        amr: result.amr,
      });
    } catch (error) {
      this.handleError(error, res, next);
    }
  };
}
