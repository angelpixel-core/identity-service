import { Request, Response, NextFunction } from 'express';
import { ValidateClientOriginQueryHandler } from '../../../../../src/contexts/identity/application/queries/validate_client_origin/handler';
import {
  ClientValidationErrorCode,
  ClientValidationResultDTO,
} from '../../../../../src/contexts/identity/application/dtos/client_validation/dto';

/**
 * Mapa de traducción de códigos de error de aplicación a códigos de estado HTTP estándar OAuth2/OIDC.
 */
export function mapValidationErrorToHttpStatus(errorCode?: ClientValidationErrorCode): number {
  switch (errorCode) {
    case 'missing_client_id':
    case 'invalid_client_id':
      return 400;
    case 'client_deactivated':
      return 401;
    case 'unauthorized_client_origin':
      return 403;
    case 'client_not_found':
      return 404;
    default:
      return 400;
  }
}

/**
 * Extrae el clientId y el origin desde los headers, body o query params de una petición Express.
 */
export function extractClientValidationParams(req: Request): {
  clientId?: string;
  origin?: string;
} {
  const rawClientId =
    (req.headers['x-client-id'] as string) ||
    (req.body && req.body.clientId) ||
    (req.query && (req.query.client_id as string));

  let originHeader = req.headers.origin as string | undefined;
  if (!originHeader && req.headers.referer) {
    try {
      originHeader = new URL(req.headers.referer).origin;
    } catch {
      originHeader = req.headers.referer;
    }
  }

  return {
    clientId: rawClientId,
    origin: originHeader,
  };
}

/**
 * REST Driver Controller: OAuth2ClientController
 * Gestiona las peticiones HTTP vinculadas al registro y validación de aplicaciones cliente OAuth2/OIDC.
 */
export class OAuth2ClientController {
  constructor(private readonly validateClientOriginHandler: ValidateClientOriginQueryHandler) {}

  public validateClientOrigin = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const preValidated = (req as Request & { clientValidation?: ClientValidationResultDTO })
        .clientValidation;

      const result =
        preValidated ??
        (await this.validateClientOriginHandler.execute(extractClientValidationParams(req)));

      if (!result.authorized) {
        const status = mapValidationErrorToHttpStatus(result.errorCode);
        res.status(status).json({
          error: result.errorCode ?? 'client_validation_failed',
          message: result.message ?? 'Client origin validation failed.',
        });
        return;
      }

      res.status(200).json({
        authorized: true,
        clientId: result.clientId,
        clientName: result.clientName,
        clientType: result.clientType,
        allowedOrigins: result.allowedOrigins,
        scopes: result.scopes,
      });
    } catch (error) {
      next(error);
    }
  };
}

