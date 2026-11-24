import { Request, Response, NextFunction } from 'express';
import { RegisterUserCommandHandler } from '../../../../../src/contexts/identity/application/commands/register_user/handler';
import { LoginUserCommandHandler } from '../../../../../src/contexts/identity/application/commands/login_user/handler';
import { GetUserProfileQueryHandler } from '../../../../../src/contexts/identity/application/queries/get_user_profile/handler';
import { LoginUserSchema, RegisterUserSchema } from './schemas';
import { OAuth2AuthenticationError } from '../../../../../src/contexts/identity/domain/exceptions/oauth2/error';
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
    private readonly getProfileHandler?: GetUserProfileQueryHandler,
    private readonly loginHandler?: LoginUserCommandHandler
  ) {}

  public register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parseResult = RegisterUserSchema.safeParse(req.body);
      if (!parseResult.success) {
        const firstIssue = parseResult.error.issues[0];
        res.status(400).json({
          error: 'validation_error',
          message: firstIssue ? firstIssue.message : 'Invalid request payload',
          details: parseResult.error.issues,
        });
        return;
      }

      const tenantId = req.tenantId!;
      const { email, password, roles, phone } = parseResult.data;

      const result = await this.registerHandler.execute({
        email,
        password,
        tenantId,
        roles,
        phone,
      });

      res.status(201).json({
        token: result.accessToken,
        accessToken: result.accessToken,
        userId: result.userId,
        email: result.email,
        tenantId: result.tenantId,
        roles: result.roles,
        phone: result.phone ?? null,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof OAuth2AuthenticationError) {
        res.status(error.statusCode).json({
          error: error.errorCode,
          message: error.errorDescription,
        });
        return;
      }
      if (error instanceof ConflictError) {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error instanceof DomainValidationError) {
        const isPhoneValidation = error.message.toLowerCase().includes('phone');
        res.status(400).json({
          error: isPhoneValidation ? 'validation_error' : error.message,
          errorCode: 'validation_error',
          message: error.message,
        });
        return;
      }
      next(error);
    }
  };

  public login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!this.loginHandler) {
        res.status(501).json({ error: 'Login handler not configured' });
        return;
      }

      const parseResult = LoginUserSchema.safeParse(req.body);
      if (!parseResult.success) {
        const firstIssue = parseResult.error.issues[0];
        res.status(400).json({
          error: 'validation_error',
          message: firstIssue ? firstIssue.message : 'Invalid request payload',
          details: parseResult.error.issues,
        });
        return;
      }

      const tenantId = req.tenantId!;
      const { email, password } = parseResult.data;

      const result = await this.loginHandler.execute({
        email,
        password,
        tenantId,
        ip: req.ip,
      });

      res.status(200).json({
        token: result.accessToken,
        accessToken: result.accessToken,
        userId: result.userId,
        email: result.email,
        tenantId: result.tenantId,
        roles: result.roles,
        phone: result.phone,
      });
    } catch (error) {
      if (error instanceof OAuth2AuthenticationError) {
        res.status(error.statusCode).json({
          error: error.errorCode,
          message: error.errorDescription,
        });
        return;
      }
      if (error instanceof DomainValidationError) {
        const isPhoneValidation = error.message.toLowerCase().includes('phone');
        res.status(400).json({
          error: isPhoneValidation ? 'validation_error' : error.message,
          errorCode: 'validation_error',
          message: error.message,
        });
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
