// 1. Librerías Externas (Node.js runtime y frameworks)
import type { Request, Response, NextFunction } from 'express';

// 4. Capa de Aplicación (Puertos, Casos de Uso y DTOs)
import type { GetUserProfileQueryHandler } from '@identity/application/queries/get_user_profile/handler';
import type { UpdateUserProfileCommandHandler } from '@identity/application/commands/update_user_profile/handler';
import type { DeleteUserCommandHandler } from '@identity/application/commands/delete_user/handler';

// 5. Capa de Dominio (Excepciones y Value Objects)
import { DomainValidationError } from '@identity/domain/exceptions/user/error';

/**
 * REST Driver Controller: UserController (US-06 / GDPR Teardown)
 * Maneja consultas, mutaciones y eliminaciones físicas sobre el recurso /api/v1/users/:userId
 * con protección estricta contra enumeración cross-tenant (404 Not Found).
 */
export class UserController {
  constructor(
    private readonly getProfileHandler: GetUserProfileQueryHandler,
    private readonly updateProfileHandler: UpdateUserProfileCommandHandler,
    private readonly deleteUserHandler?: DeleteUserCommandHandler
  ) {}

  public getUserById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const targetUserId = req.params.userId as string | undefined;
      const tenantId = req.tenantId;

      if (!targetUserId || !tenantId) {
        res.status(400).json({ error: 'Missing userId or tenant context' });
        return;
      }

      const profile = await this.getProfileHandler.execute({
        userId: targetUserId,
        tenantId,
      });

      res.status(200).json(profile);
    } catch (error: any) {
      if (error?.message?.includes('not found')) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      next(error);
    }
  };

  public updateUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const targetUserId = req.params.userId as string | undefined;
      const tenantIdStr = req.tenantId;

      if (!targetUserId || !tenantIdStr) {
        res.status(400).json({ error: 'Missing userId or tenant context' });
        return;
      }

      const updatedProfile = await this.updateProfileHandler.execute({
        userId: targetUserId,
        tenantId: tenantIdStr,
        email: req.body?.email,
      });

      res.status(200).json(updatedProfile);
    } catch (error: any) {
      if (error instanceof DomainValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      if (error?.message?.includes('not found')) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      next(error);
    }
  };

  public deleteUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const targetUserId = req.params.userId as string | undefined;
      const tenantIdStr = req.tenantId;

      if (!targetUserId || !tenantIdStr) {
        res.status(400).json({ error: 'Missing userId or tenant context' });
        return;
      }

      if (!this.deleteUserHandler) {
        res.status(501).json({ error: 'Delete user handler not configured' });
        return;
      }

      await this.deleteUserHandler.execute({
        userId: targetUserId,
        tenantId: tenantIdStr,
      });

      res.status(204).send();
    } catch (error: any) {
      if (error instanceof DomainValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      if (error?.message?.includes('not found')) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      next(error);
    }
  };
}
