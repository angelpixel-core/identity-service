import { Request, Response, NextFunction } from 'express';
import { RegisterUserCommandHandler } from '../../../../../src/contexts/identity/application/commands/register_user/handler';
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
  constructor(private readonly registerHandler: RegisterUserCommandHandler) {}

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
      const { email, password } = parseResult.data;

      const result = await this.registerHandler.execute({
        email,
        password,
        tenantId,
      });

      res.status(201).json({
        token: result.accessToken,
        accessToken: result.accessToken,
        userId: result.userId,
        email: result.email,
        tenantId: result.tenantId,
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
}
