import { Request, Response, NextFunction } from 'express';
import { GetUserProfileQueryHandler } from '../../../../../src/contexts/identity/application/queries/get_user_profile/handler';
import { UserRepositoryPort } from '../../../../../src/contexts/identity/application/ports/user/repository';
import { CacheProviderPort } from '../../../../../src/contexts/identity/application/ports/cache/cache_provider';
import { TenantId } from '../../../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { Email } from '../../../../../src/contexts/identity/domain/value_objects/email/value';
import { User } from '../../../../../src/contexts/identity/domain/entities/user/aggregate';
import { DomainValidationError } from '../../../../../src/contexts/identity/domain/exceptions/user/error';

/**
 * REST Driver Controller: UserController (US-06)
 * Maneja consultas y mutaciones sobre el recurso /api/v1/users/:userId
 * con protección estricta contra enumeración cross-tenant (404 Not Found).
 */
export class UserController {
  constructor(
    private readonly getProfileHandler: GetUserProfileQueryHandler,
    private readonly userRepository: UserRepositoryPort,
    private readonly cacheProvider?: CacheProviderPort
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

      const tenantId = TenantId.create(tenantIdStr);
      const existingUser = await this.userRepository.findById(targetUserId, tenantId);

      if (!existingUser) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const newEmail = req.body?.email
        ? Email.create(String(req.body.email))
        : existingUser.getEmail();

      const updatedUser = User.reconstitute({
        id: existingUser.getId(),
        email: newEmail,
        passwordHash: existingUser.getPasswordHash(),
        tenantId: existingUser.getTenantId(),
        createdAt: existingUser.getCreatedAt(),
        updatedAt: new Date(),
      });

      await this.userRepository.save(updatedUser);

      if (this.cacheProvider) {
        const cacheKey = `user_profile:${tenantIdStr}:${targetUserId}`;
        await this.cacheProvider.delete(cacheKey);
      }

      res.status(200).json({
        id: updatedUser.getId(),
        email: updatedUser.getEmail().getValue(),
        tenantId: updatedUser.getTenantId().getValue(),
        createdAt: updatedUser.getCreatedAt(),
        updatedAt: updatedUser.getUpdatedAt(),
      });
    } catch (error) {
      if (error instanceof DomainValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  };
}
