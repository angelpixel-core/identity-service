import { User } from '../../../../domain/entities/user/aggregate';
import { Email } from '../../../../domain/value_objects/email/value';
import { PhoneNumber } from '../../../../domain/value_objects/phone_number/value';
import { TenantId } from '../../../../domain/value_objects/tenant_id/value';
import { UserDatabaseModel } from '../../models/user/model';

/**
 * Data Mapper: UserMapper
 * Transforma bidireccionalmente entre el modelo de base de datos relacional y el agregado puro de dominio User.
 */
export class UserMapper {
  public static toDomain(raw: UserDatabaseModel): User {
    const roles = Array.isArray(raw.roles) && raw.roles.length > 0 ? raw.roles : ['member'];
    return User.reconstitute({
      id: raw.id,
      email: Email.create(raw.email),
      tenantId: TenantId.create(raw.tenant_id),
      passwordHash: raw.password_hash,
      roles,
      phone: raw.phone ? PhoneNumber.create(raw.phone) : null,
      createdAt: raw.created_at instanceof Date ? raw.created_at : new Date(raw.created_at),
      updatedAt: raw.updated_at instanceof Date ? raw.updated_at : new Date(raw.updated_at),
    });
  }

  public static toPersistence(user: User): UserDatabaseModel {
    return {
      id: user.getId(),
      email: user.getEmail().getValue(),
      password_hash: user.getPasswordHash(),
      tenant_id: user.getTenantId().getValue(),
      roles: user.getRoles(),
      phone: user.getPhone()?.getValue() ?? null,
      created_at: user.getCreatedAt(),
      updated_at: user.getUpdatedAt(),
    };
  }
}

