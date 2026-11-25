import { Request, Response, NextFunction } from 'express';
import {
  GetKycStatusQueryHandler,
  ProcessKycWebhookCommandHandler,
  StartKycVerificationCommandHandler,
} from '../../../../../src/contexts/identity/application/commands/manage_kyc_verification/handler';
import { OAuth2AuthenticationError } from '../../../../../src/contexts/identity/domain/exceptions/oauth2/error';
import { DomainValidationError } from '../../../../../src/contexts/identity/domain/exceptions/user/error';

/**
 * REST Driver Controller: KycController (US-37)
 */
export class KycController {
  constructor(
    private readonly startSessionHandler: StartKycVerificationCommandHandler,
    private readonly processWebhookHandler: ProcessKycWebhookCommandHandler,
    private readonly getStatusHandler: GetKycStatusQueryHandler
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

  public startSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.userId || !req.tenantId) {
        res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
        return;
      }

      const body = req.body ?? {};
      const result = await this.startSessionHandler.execute({
        userId: req.userId,
        tenantId: req.tenantId,
        level: body.level,
        ip: req.ip,
      });

      res.status(201).json(result);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  public getStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.userId || !req.tenantId) {
        res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
        return;
      }

      const result = await this.getStatusHandler.execute(req.userId, req.tenantId);
      res.status(200).json(result);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  public handleWebhookResult = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const body = req.body ?? {};
      const tenantId = req.tenantId || body.tenantId || body.tenant_id || '';
      const rawBody =
        typeof (req as Request & { rawBody?: string }).rawBody === 'string'
          ? (req as Request & { rawBody?: string }).rawBody!
          : JSON.stringify(body);
      const signatureHeader =
        (req.headers['x-kyc-signature'] as string | undefined) || undefined;

      const result = await this.processWebhookHandler.execute({
        tenantId,
        providerRef: body.providerRef ?? body.provider_ref ?? '',
        verdict: body.verdict ?? body.status,
        expiresAt: body.expiresAt ?? body.expires_at ?? null,
        rawBody,
        signatureHeader,
        ip: req.ip,
      });

      res.status(200).json(result);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };
}
