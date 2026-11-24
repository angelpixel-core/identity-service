import { Request, Response, NextFunction } from 'express';
import { GetTenantPolicyQueryHandler } from '../../../../../src/contexts/identity/application/queries/get_tenant_policy/handler';
import { UpsertTenantPolicyCommandHandler } from '../../../../../src/contexts/identity/application/commands/upsert_tenant_policy/handler';
import { InvalidTenantPolicyError } from '../../../../../src/contexts/identity/domain/entities/tenant_policy/entity';
import { DomainValidationError } from '../../../../../src/contexts/identity/domain/exceptions/user/error';
import { OAuth2AuthenticationError } from '../../../../../src/contexts/identity/domain/exceptions/oauth2/error';

function getCallerContext(req: Request): {
  tenantId: string;
  userId: string;
  roles: string[];
  isRootOperator: boolean;
} {
  const tenantId = req.tenantId || (req.headers['x-tenant-id'] as string | undefined) || 'acme-corp';
  const roles = Array.isArray(req.userRoles) ? req.userRoles : [];
  const isRootOperator = Boolean(req.isRootAdmin) || (tenantId === 'system' && roles.includes('superadmin'));
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
 * REST Driver Controller: TenantPolicyController (US-30)
 */
export class TenantPolicyController {
  constructor(
    private readonly getPolicyHandler: GetTenantPolicyQueryHandler,
    private readonly upsertPolicyHandler: UpsertTenantPolicyCommandHandler
  ) {}

  private handleError(error: unknown, res: Response, next: NextFunction): void {
    if (error instanceof InvalidTenantPolicyError) {
      res.status(400).json({
        error: error.errorCode,
        message: error.message,
      });
      return;
    }
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

  public getPolicy = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { tenantId, isRootOperator } = getCallerContext(req);
      const targetTenantId = paramStr(req.params.tenantId);

      const dto = await this.getPolicyHandler.execute({
        targetTenantId,
        callerTenantId: tenantId,
        isRootOperator,
      });

      res.status(200).json(dto);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  public upsertPolicy = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { tenantId, userId, roles, isRootOperator } = getCallerContext(req);
      const targetTenantId = paramStr(req.params.tenantId);
      const body = req.body ?? {};

      const dto = await this.upsertPolicyHandler.execute({
        targetTenantId,
        callerTenantId: tenantId,
        callerRoles: roles,
        isRootOperator,
        actorId: userId,
        requiredAttributes: body.requiredAttributes ?? body.required_attributes,
        kycPolicy: body.kycPolicy ?? body.kyc_policy,
        allowedAuthMethods: body.allowedAuthMethods ?? body.allowed_auth_methods,
      });

      res.status(200).json(dto);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };
}
