import { NextFunction, Request, Response } from 'express';
import { RegisterTenantFederatedProviderCommandHandler } from '../../../../../src/contexts/identity/application/commands/register_tenant_federated_provider/handler';
import { RemoveTenantFederatedProviderCommandHandler } from '../../../../../src/contexts/identity/application/commands/remove_tenant_federated_provider/handler';
import { ListTenantFederatedProvidersQueryHandler } from '../../../../../src/contexts/identity/application/queries/list_tenant_federated_providers/handler';
import { FederatedProviderProtocol } from '../../../../../src/contexts/identity/domain/entities/tenant_federated_provider/entity';
import { OAuth2AuthenticationError } from '../../../../../src/contexts/identity/domain/exceptions/oauth2/error';
import { DomainValidationError } from '../../../../../src/contexts/identity/domain/exceptions/user/error';

function getCallerContext(req: Request): {
  tenantId: string;
  userId: string;
  roles: string[];
  isRootOperator: boolean;
} {
  const tenantId = req.tenantId || (req.headers['x-tenant-id'] as string | undefined) || 'acme-corp';
  const roles = Array.isArray(req.userRoles) ? req.userRoles : [];
  const isRootOperator =
    Boolean(req.isRootAdmin) || (tenantId === 'system' && roles.includes('superadmin'));
  return {
    tenantId,
    userId: req.userId || 'unknown-actor',
    roles,
    isRootOperator,
  };
}

function paramStr(val: string | string[] | undefined): string {
  return (Array.isArray(val) ? val[0] : val) ?? '';
}

/**
 * REST Driver Controller: TenantFederationController (US-33)
 */
export class TenantFederationController {
  constructor(
    private readonly listProvidersHandler: ListTenantFederatedProvidersQueryHandler,
    private readonly registerProviderHandler: RegisterTenantFederatedProviderCommandHandler,
    private readonly removeProviderHandler: RemoveTenantFederatedProviderCommandHandler
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
      res.status(400).json({
        error: 'validation_error',
        message: error.message,
      });
      return;
    }
    next(error);
  }

  public listProviders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const targetTenantId = paramStr(req.params.tenantId);
      const caller = getCallerContext(req);
      const providers = await this.listProvidersHandler.execute({
        targetTenantId,
        callerTenantId: caller.tenantId,
        isRootOperator: caller.isRootOperator,
      });
      res.status(200).json({
        tenantId: targetTenantId,
        count: providers.length,
        providers,
      });
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  public upsertProvider = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const targetTenantId = paramStr(req.params.tenantId);
      const caller = getCallerContext(req);
      const body = (req.body ?? {}) as Record<string, unknown>;

      const providerKey = typeof body.providerKey === 'string' ? body.providerKey : '';
      const displayName = typeof body.displayName === 'string' ? body.displayName : '';
      const protocol = (body.protocol === 'oauth2' ? 'oauth2' : 'oidc') as FederatedProviderProtocol;
      const issuerUrl = typeof body.issuerUrl === 'string' ? body.issuerUrl : '';
      const clientId = typeof body.clientId === 'string' ? body.clientId : '';
      const clientSecret =
        typeof body.clientSecret === 'string' ? body.clientSecret : undefined;

      if (!providerKey.trim() || !displayName.trim() || !issuerUrl.trim() || !clientId.trim()) {
        res.status(400).json({
          error: 'validation_error',
          message: 'providerKey, displayName, issuerUrl and clientId are required',
        });
        return;
      }

      const result = await this.registerProviderHandler.execute({
        targetTenantId,
        callerTenantId: caller.tenantId,
        callerRoles: caller.roles,
        isRootOperator: caller.isRootOperator,
        actorId: caller.userId,
        providerKey,
        displayName,
        protocol,
        issuerUrl,
        authorizationEndpoint:
          typeof body.authorizationEndpoint === 'string' ? body.authorizationEndpoint : null,
        tokenEndpoint: typeof body.tokenEndpoint === 'string' ? body.tokenEndpoint : null,
        jwksUri: typeof body.jwksUri === 'string' ? body.jwksUri : null,
        clientId,
        clientSecret,
        scopes: Array.isArray(body.scopes)
          ? body.scopes.filter((s): s is string => typeof s === 'string')
          : undefined,
        enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      });

      res.status(result.created ? 201 : 200).json(result.provider);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  public removeProvider = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const targetTenantId = paramStr(req.params.tenantId);
      const providerKey = paramStr(req.params.providerKey);
      const caller = getCallerContext(req);
      const result = await this.removeProviderHandler.execute({
        targetTenantId,
        callerTenantId: caller.tenantId,
        callerRoles: caller.roles,
        isRootOperator: caller.isRootOperator,
        actorId: caller.userId,
        providerKey,
      });

      if (!result.removed) {
        res.status(404).json({
          error: 'provider_not_found',
          message: `Federated provider "${result.providerKey}" not found for tenant "${targetTenantId}"`,
        });
        return;
      }

      res.status(200).json(result);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };
}
