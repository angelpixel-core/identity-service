import { User } from '../../../domain/entities/user/aggregate';
import { Email } from '../../../domain/value_objects/email/value';
import { TenantId } from '../../../domain/value_objects/tenant_id/value';

/**
 * Secondary Port (SPI): UserRepositoryPort
 * Contrato abstracto de persistencia del agregado User.
 * Exige explícitamente el TenantId en las operaciones de búsqueda para garantizar
 * aislamiento estricto entre organizaciones en la capa de persistencia.
 */
export interface UserRepositoryPort {
  save(user: User): Promise<void>;
  findById(id: string, tenantId: TenantId): Promise<User | null>;
  findByEmail(email: Email, tenantId: TenantId): Promise<User | null>;
}

