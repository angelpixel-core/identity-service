// 4. Capa de Aplicación (Puertos y Contratos)
import type { UserRepositoryPort } from '@identity/application/ports/user/repository';
import type { CacheProviderPort } from '@identity/application/ports/cache/cache_provider';
import type { DeleteUserCommand } from '@identity/application/commands/delete_user/command';

// 5. Capa de Dominio (Value Objects y Excepciones)
import { TenantId } from '@identity/domain/value_objects/tenant_id/value';
import { DomainValidationError } from '@identity/domain/exceptions/user/error';

/**
 * Caso de Uso (Write Slice): Eliminación Física de Usuario Multi-Tenant.
 * 1. Valida invariantes de entrada (userId y tenantId no vacíos).
 * 2. Verifica la existencia del usuario dentro del inquilino autenticado (Anti-Enumeración).
 * 3. Ejecuta el borrado físico (Hard Delete) atómico en la capa de persistencia.
 * 4. Desaloja la caché Redis para mantener consistencia inmediata en lecturas subsecuentes.
 */
export class DeleteUserCommandHandler {
  constructor(
    private readonly userRepository: UserRepositoryPort,
    private readonly cacheProvider?: CacheProviderPort
  ) {}

  public async execute(command: DeleteUserCommand): Promise<void> {
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

    await this.userRepository.delete(command.userId, tenantId);

    if (this.cacheProvider) {
      const cacheKey = `user_profile:${command.tenantId}:${command.userId}`;
      await this.cacheProvider.delete(cacheKey);
    }
  }
}
