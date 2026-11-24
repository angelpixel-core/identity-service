import { Request, Response, NextFunction } from 'express';
import { ValidateClientOriginQueryHandler } from '../../../../../src/contexts/identity/application/queries/validate_client_origin/handler';
import { ClientApplicationRepositoryPort } from '../../../../../src/contexts/identity/domain/ports/client_application_repository_port';
import {
  ClientValidationErrorCode,
  ClientValidationResultDTO,
} from '../../../../../src/contexts/identity/application/dtos/client_validation/dto';
import {
  RegisterClientCommandHandler,
  toClientSafeViewDTO,
} from '../../../../../src/contexts/identity/application/commands/register_client/handler';
import { UpdateClientCommandHandler } from '../../../../../src/contexts/identity/application/commands/update_client/handler';
import { RotateClientSecretCommandHandler } from '../../../../../src/contexts/identity/application/commands/rotate_client_secret/handler';
import { DomainValidationError } from '../../../../../src/contexts/identity/domain/exceptions/user/error';
import { OAuth2AuthenticationError } from '../../../../../src/contexts/identity/domain/exceptions/oauth2/error';
import { ClientApplication } from '../../../../../src/contexts/identity/domain/entities/client_application/aggregate';

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

  const rawBodyOrigin =
    req.body && typeof req.body.origin === 'string' && req.body.origin.trim().length > 0
      ? req.body.origin.trim()
      : undefined;

  let originHeader = rawBodyOrigin || (req.headers.origin as string | undefined);
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

function getCallerContext(req: Request): {
  tenantId: string;
  userId?: string;
  isRootOperator: boolean;
} {
  const tenantId = req.tenantId || (req.headers['x-tenant-id'] as string | undefined) || 'acme-corp';
  const roles = Array.isArray(req.userRoles) ? req.userRoles : [];
  const isRootOperator = Boolean(req.isRootAdmin) || (tenantId === 'system' && roles.includes('superadmin'));
  return {
    tenantId,
    userId: req.userId,
    isRootOperator,
  };
}

/**
 * REST Driver Controller: OAuth2ClientController
 * Gestiona las peticiones HTTP vinculadas al registro, ciclo de vida, rotación de secretos y validación de clientes OAuth2/OIDC.
 */
export class OAuth2ClientController {
  constructor(
    private readonly validateClientOriginHandler: ValidateClientOriginQueryHandler,
    private readonly clientRepository?: ClientApplicationRepositoryPort,
    private readonly registerClientHandler?: RegisterClientCommandHandler,
    private readonly updateClientHandler?: UpdateClientCommandHandler,
    private readonly rotateClientSecretHandler?: RotateClientSecretCommandHandler
  ) {}

  private handleControllerError(error: unknown, res: Response, next: NextFunction): void {
    if (error instanceof OAuth2AuthenticationError) {
      res.status(error.statusCode).json({
        error: error.errorCode,
        error_description: error.errorDescription,
        message: error.errorDescription,
      });
      return;
    }

    if (error instanceof DomainValidationError) {
      const status = (error as Error & { statusCode?: number }).statusCode ?? 400;
      res.status(status).json({
        error: status === 404 ? 'not_found' : status === 409 ? 'conflict' : 'validation_error',
        message: error.message,
      });
      return;
    }

    next(error);
  }

  public listClients = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { tenantId, isRootOperator } = getCallerContext(req);

      let clients: ClientApplication[] = [];
      if (
        !isRootOperator &&
        req.headers['x-tenant-id'] &&
        this.clientRepository &&
        typeof this.clientRepository.findByTenantId === 'function'
      ) {
        clients = await this.clientRepository.findByTenantId(tenantId);
      } else if (this.clientRepository && typeof this.clientRepository.findAll === 'function') {
        clients = await this.clientRepository.findAll();
      }

      const safeClients = clients.map((client) => toClientSafeViewDTO(client));

      res.status(200).json({
        count: safeClients.length,
        clients: safeClients,
      });
    } catch (error) {
      next(error);
    }
  };

  public registerClient = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!this.registerClientHandler) {
        res.status(501).json({ error: 'not_implemented', message: 'RegisterClientCommandHandler is not configured' });
        return;
      }

      const { tenantId, userId, isRootOperator } = getCallerContext(req);
      const body = req.body ?? {};
      const targetTenantId =
        isRootOperator && typeof body.tenantId === 'string' && body.tenantId.trim()
          ? body.tenantId.trim()
          : tenantId;

      const result = await this.registerClientHandler.execute({
        tenantId: targetTenantId,
        clientId: body.clientId ?? body.client_id,
        clientName: body.clientName ?? body.client_name,
        clientType: body.clientType ?? body.client_type,
        clientProfile: body.clientProfile ?? body.client_profile,
        allowedOrigins: body.allowedOrigins ?? body.allowed_origins ?? [],
        redirectUris: body.redirectUris ?? body.redirect_uris ?? [],
        allowedGrantTypes: body.allowedGrantTypes ?? body.allowed_grant_types,
        scopes: body.scopes,
        actorUserId: userId,
      });

      res.status(201).json(result);
    } catch (error) {
      this.handleControllerError(error, res, next);
    }
  };

  public updateClient = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!this.updateClientHandler) {
        res.status(501).json({ error: 'not_implemented', message: 'UpdateClientCommandHandler is not configured' });
        return;
      }

      const { tenantId, userId, isRootOperator } = getCallerContext(req);
      const body = req.body ?? {};
      const rawClientId =
        (Array.isArray(req.params.clientId) ? req.params.clientId[0] : req.params.clientId) ?? '';

      const result = await this.updateClientHandler.execute({
        tenantId,
        clientId: rawClientId,
        isRootOperator,
        clientName: body.clientName ?? body.client_name,
        allowedOrigins: body.allowedOrigins ?? body.allowed_origins,
        redirectUris: body.redirectUris ?? body.redirect_uris,
        allowedGrantTypes: body.allowedGrantTypes ?? body.allowed_grant_types,
        scopes: body.scopes,
        status: body.status,
        actorUserId: userId,
      });

      res.status(200).json(result);
    } catch (error) {
      this.handleControllerError(error, res, next);
    }
  };

  public rotateClientSecret = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!this.rotateClientSecretHandler) {
        res.status(501).json({ error: 'not_implemented', message: 'RotateClientSecretCommandHandler is not configured' });
        return;
      }

      const { tenantId, userId, isRootOperator } = getCallerContext(req);
      const body = req.body ?? {};
      const rawClientId =
        (Array.isArray(req.params.clientId) ? req.params.clientId[0] : req.params.clientId) ?? '';
      const rawGrace = body.gracePeriodSeconds ?? body.grace_period_seconds;

      const result = await this.rotateClientSecretHandler.execute({
        tenantId,
        clientId: rawClientId,
        gracePeriodSeconds: rawGrace !== undefined ? Number(rawGrace) : 0,
        isRootOperator,
        actorUserId: userId,
      });

      res.status(200).json(result);
    } catch (error) {
      this.handleControllerError(error, res, next);
    }
  };

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

