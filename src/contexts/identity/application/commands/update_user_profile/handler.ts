import { UserRepositoryPort } from '../../ports/user/repository';
import { CacheProviderPort } from '../../ports/cache/cache_provider';
import { TenantId } from '../../../domain/value_objects/tenant_id/value';
import { Email } from '../../../domain/value_objects/email/value';
import { UserProfileDTO } from '../../dtos/user_profile/dto';
import { UpdateUserProfileCommand } from './command';
import { DomainValidationError } from '../../../domain/exceptions/user/error';

/**
 * Caso de uso (Write Slice): Actualización de perfil de usuario multi-tenant.
 * 1. Verifica existencia del usuario dentro del tenant autenticado.
 * 2. Aplica invariantes de dominio (formato de Email).
 * 3. Muta la entidad de dominio y persiste los cambios.
 * 4. Invalida la entrada correspondiente en caché para garantizar consistencia.
 */
export class UpdateUserProfileCommandHandler {
  constructor(
    private readonly userRepository: UserRepositoryPort,
    private readonly cacheProvider?: CacheProviderPort
  ) {}

  public async execute(command: UpdateUserProfileCommand): Promise<UserProfileDTO> {
    if (!command.userId || command.userId.trim().length === 0) {
      throw new DomainValidationError('User id must be provided');
    }

    if (!command.tenantId || command.tenantId.trim().length === 0) {
      throw new DomainValidationError('Tenant id must be provided');
    }

    const tenantId = TenantId.create(command.tenantId);
    const user = await this.userRepository.findById(command.userId, tenantId);

    if (!user) {
      throw new Error(`User not found in tenant ${command.tenantId}`);
    }

    if (command.email !== undefined) {
      const newEmail = Email.create(command.email);
      user.updateEmail(newEmail);
    }

    await this.userRepository.save(user);

    if (this.cacheProvider) {
      const cacheKey = `user_profile:${command.tenantId}:${command.userId}`;
      await this.cacheProvider.delete(cacheKey);
    }

    return {
      id: user.getId(),
      email: user.getEmail().getValue(),
      tenantId: user.getTenantId().getValue(),
      createdAt: user.getCreatedAt(),
      updatedAt: user.getUpdatedAt(),
    };
  }
}
