import { FederatedIdentity } from '../../../../domain/entities/federated_identity/aggregate';
import { FederatedProviderId } from '../../../../domain/ports/external_identity_provider_port';
import { Email } from '../../../../domain/value_objects/email/value';
import { TenantId } from '../../../../domain/value_objects/tenant_id/value';
import { FederatedIdentityDatabaseModel } from '../../models/federated_identity/model';

export class FederatedIdentityMapper {
  public static toDomain(raw: FederatedIdentityDatabaseModel): FederatedIdentity {
    return FederatedIdentity.reconstitute({
      id: raw.id,
      userId: raw.user_id,
      tenantId: TenantId.create(raw.tenant_id),
      provider: raw.provider as FederatedProviderId,
      externalSubjectId: raw.external_subject_id,
      externalEmail: Email.create(raw.external_email),
      createdAt: raw.created_at instanceof Date ? raw.created_at : new Date(raw.created_at),
      updatedAt: raw.updated_at instanceof Date ? raw.updated_at : new Date(raw.updated_at),
    });
  }

  public static toPersistence(entity: FederatedIdentity): FederatedIdentityDatabaseModel {
    return {
      id: entity.getId(),
      user_id: entity.getUserId(),
      tenant_id: entity.getTenantId().getValue(),
      provider: entity.getProvider(),
      external_subject_id: entity.getExternalSubjectId(),
      external_email: entity.getExternalEmail().getValue(),
      created_at: entity.getCreatedAt(),
      updated_at: entity.getUpdatedAt(),
    };
  }
}
