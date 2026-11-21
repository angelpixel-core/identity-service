import { Request, Response, NextFunction } from 'express';
import { RegisterUserCommandHandler } from '../../../../../src/contexts/identity/application/commands/register_user/handler';
import { GetUserProfileQueryHandler } from '../../../../../src/contexts/identity/application/queries/get_user_profile/handler';
import { RegisterUserSchema } from './schemas';
import {
  DomainValidationError,
  ConflictError,
} from '../../../../../src/contexts/identity/domain/exceptions/user/error';

/**
 * REST Driver Controller: AuthController
 * Maneja peticiones HTTP entrantes para casos de uso de autenticación e identidad.
 */
export class AuthController {
  constructor(
    private readonly registerHandler: RegisterUserCommandHandler,
    private readonly getProfileHandler?: GetUserProfileQueryHandler
  ) {}

  public register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parseResult = RegisterUserSchema.safeParse(req.body);
      if (!parseResult.success) {
        const firstIssue = parseResult.error.issues[0];
        res.status(400).json({
          error: firstIssue ? firstIssue.message : 'Invalid request payload',
          details: parseResult.error.issues,
        });
        return;
      }

      const tenantId = req.tenantId!;
      const { email, password, roles } = parseResult.data;

      const result = await this.registerHandler.execute({
        email,
        password,
        tenantId,
        roles,
      });

      res.status(201).json({
        token: result.accessToken,
        accessToken: result.accessToken,
        userId: result.userId,
        email: result.email,
        tenantId: result.tenantId,
        roles: result.roles,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof ConflictError) {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error instanceof DomainValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  };

  public getProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId;
      const tenantId = req.tenantId;

      if (!userId || !tenantId) {
        res.status(401).json({ error: 'Unauthorized: Missing user identity or tenant context' });
        return;
      }

      if (!this.getProfileHandler) {
        res.status(501).json({ error: 'Profile handler not configured' });
        return;
      }

      const { profile, cacheStatus } = await this.getProfileHandler.executeWithMeta({
        userId,
        tenantId,
      });
      res.setHeader('X-Cache', cacheStatus);
      if (process.env.NODE_ENV !== 'test') {
        console.info(
          `[Cache-Aside] GET /api/v1/auth/me -> X-Cache=${cacheStatus} tenant=${tenantId} userId=${userId}`
        );
      }
      res.status(200).json(profile);
    } catch (error: any) {
      if (error?.message?.includes('not found')) {
        res.status(404).json({ error: error.message });
        return;
      }
      next(error);
    }
  };
}
