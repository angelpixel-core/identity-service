// 5. Capa de Dominio (Entidades y Value Objects)
import type { User } from '@identity/domain/entities/user/aggregate';
import type { Email } from '@identity/domain/value_objects/email/value';
import type { TenantId } from '@identity/domain/value_objects/tenant_id/value';

/**
 * Secondary Port (SPI): UserRepositoryPort
 * Contrato abstracto de persistencia del agregado User.
 * Exige explícitamente el TenantId en las operaciones de búsqueda y mutación para garantizar
 * aislamiento estricto entre organizaciones en la capa de persistencia (Multi-Tenant Zero-Trust).
 */
export interface UserRepositoryPort {
  save(user: User): Promise<void>;
  findById(id: string, tenantId: TenantId): Promise<User | null>;
  findByEmail(email: Email, tenantId: TenantId): Promise<User | null>;
  delete(id: string, tenantId: TenantId): Promise<boolean>;
}

