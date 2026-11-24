import { Request, Response, NextFunction } from 'express';
import { ClientTenantBindingRepositoryPort } from '../../../../../src/contexts/identity/domain/ports/client_tenant_binding_repository_port';
import { ClientId } from '../../../../../src/contexts/identity/domain/value_objects/client_id/value';
import {
  CreateClientTenantBindingCommandHandler,
  RevokeClientTenantBindingCommandHandler,
  UpdateClientTenantBindingCommandHandler,
  toClientTenantBindingDTO,
} from '../../../../../src/contexts/identity/application/commands/manage_client_tenant_binding/handler';
import { GetPublicAuthConfigQueryHandler } from '../../../../../src/contexts/identity/application/queries/get_public_auth_config/handler';
import { DomainValidationError } from '../../../../../src/contexts/identity/domain/exceptions/user/error';
import { OAuth2AuthenticationError } from '../../../../../src/contexts/identity/domain/exceptions/oauth2/error';

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

function paramStr(val: string | string[] | undefined): string {
  return (Array.isArray(val) ? val[0] : val) ?? '';
}

/**
 * REST Driver Controller: ClientBindingsController (US-29)
 * Gestiona bindings N:M Client <-> Tenant / Custom Domain y resolución pública /api/v1/auth/config.
 */
export class ClientBindingsController {
  constructor(
    private readonly bindingRepository: ClientTenantBindingRepositoryPort,
    private readonly createBindingHandler: CreateClientTenantBindingCommandHandler,
    private readonly updateBindingHandler: UpdateClientTenantBindingCommandHandler,
    private readonly revokeBindingHandler: RevokeClientTenantBindingCommandHandler,
    private readonly getPublicAuthConfigHandler: GetPublicAuthConfigQueryHandler
  ) {}

  private handleError(error: unknown, res: Response, next: NextFunction): void {
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

  public listBindings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { tenantId, isRootOperator } = getCallerContext(req);
      const clientId = ClientId.create(paramStr(req.params.clientId));
      const all = await this.bindingRepository.findByClientId(clientId);
      const visible = isRootOperator
        ? all
        : all.filter((b) => b.getTenantId().getValue() === tenantId);

      const bindings = visible.map((b) => toClientTenantBindingDTO(b));
      res.status(200).json({ count: bindings.length, bindings });
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  public createBinding = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { tenantId, userId, isRootOperator } = getCallerContext(req);
      const body = req.body ?? {};
      const clientId = paramStr(req.params.clientId);
      const targetTenantId = body.tenantId ?? body.tenant_id ?? tenantId;

      const created = await this.createBindingHandler.execute({
        clientId,
        tenantId: targetTenantId,
        callerTenantId: tenantId,
        isRootOperator,
        customDomain: body.customDomain ?? body.custom_domain ?? null,
        allowedRedirectUris: body.allowedRedirectUris ?? body.allowed_redirect_uris ?? [],
        allowedCorsOrigins: body.allowedCorsOrigins ?? body.allowed_cors_origins ?? [],
        actorUserId: userId,
      });

      res.status(201).json(created);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  public updateBinding = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { tenantId, userId, isRootOperator } = getCallerContext(req);
      const body = req.body ?? {};
      const clientId = paramStr(req.params.clientId);
      const bindingId = paramStr(req.params.bindingId);

      const updated = await this.updateBindingHandler.execute({
        bindingId,
        clientId,
        callerTenantId: tenantId,
        isRootOperator,
        customDomain: body.customDomain ?? body.custom_domain,
        allowedRedirectUris: body.allowedRedirectUris ?? body.allowed_redirect_uris,
        allowedCorsOrigins: body.allowedCorsOrigins ?? body.allowed_cors_origins,
        isActive: body.isActive ?? body.is_active,
        actorUserId: userId,
      });

      res.status(200).json(updated);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  public revokeBinding = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { tenantId, userId, isRootOperator } = getCallerContext(req);
      const clientId = paramStr(req.params.clientId);
      const bindingId = paramStr(req.params.bindingId);

      await this.revokeBindingHandler.execute({
        bindingId,
        clientId,
        callerTenantId: tenantId,
        isRootOperator,
        actorUserId: userId,
      });

      res.status(200).json({ revoked: true, bindingId });
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  public getAuthConfig = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const clientId = (req.query.client_id as string) || '';
      const tenantId = (req.query.tenant_id as string) || undefined;
      const domain = (req.query.domain as string) || undefined;
      const redirectUri = (req.query.redirect_uri as string) || undefined;
      const origin = (req.headers.origin as string) || undefined;

      const { dto, etag } = await this.getPublicAuthConfigHandler.execute({
        clientId,
        tenantId,
        domain,
        redirectUri,
        origin,
        ip: req.ip,
      });

      const quotedEtag = `"${etag}"`;
      res.setHeader('ETag', quotedEtag);
      res.setHeader('Cache-Control', 'private, max-age=60');

      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch === quotedEtag || ifNoneMatch === etag) {
        res.status(304).end();
        return;
      }

      res.status(200).json(dto);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };
}
