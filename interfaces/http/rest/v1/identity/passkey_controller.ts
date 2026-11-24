import { Request, Response, NextFunction } from 'express';
import {
  BeginPasskeyRegistrationCommandHandler,
  ListPasskeysQueryHandler,
  RevokePasskeyCommandHandler,
  VerifyPasskeyRegistrationCommandHandler,
} from '../../../../../src/contexts/identity/application/commands/register_passkey/handler';
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
    private readonly revokePasskeyHandler: RevokePasskeyCommandHandler
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
}
