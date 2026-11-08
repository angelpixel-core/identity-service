import { Request, Response, NextFunction } from 'express';
import { GetUserProfileQueryHandler } from '../../../../../src/contexts/identity/application/queries/get_user_profile/handler';
import { UpdateUserProfileCommandHandler } from '../../../../../src/contexts/identity/application/commands/update_user_profile/handler';
import { DomainValidationError } from '../../../../../src/contexts/identity/domain/exceptions/user/error';

/**
 * REST Driver Controller: UserController (US-06)
 * Maneja consultas y mutaciones sobre el recurso /api/v1/users/:userId
 * con protección estricta contra enumeración cross-tenant (404 Not Found).
 */
export class UserController {
  constructor(
    private readonly getProfileHandler: GetUserProfileQueryHandler,
    private readonly updateProfileHandler: UpdateUserProfileCommandHandler
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
}
