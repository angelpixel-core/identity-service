import { Email } from '../../value_objects/email/value';
import { TenantId } from '../../value_objects/tenant_id/value';
import { DomainValidationError } from '../../exceptions/user/error';
import { FederatedProviderId } from '../../ports/external_identity_provider_port';

export interface CreateFederatedIdentityProps {
  id?: string;
  userId: string;
  tenantId: TenantId | string;
  provider: FederatedProviderId;
  externalSubjectId: string;
  externalEmail: Email | string;
}

export interface ReconstituteFederatedIdentityProps {
  id: string;
  userId: string;
  tenantId: TenantId;
  provider: FederatedProviderId;
  externalSubjectId: string;
  externalEmail: Email;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Agregado de Dominio: FederatedIdentity
 * Representa la asociación persistente e inmutable entre una cuenta local de usuario
 * y una identidad externa verificada de un Identity Provider de terceros (Google, Microsoft).
 */
export class FederatedIdentity {
  private readonly id: string;
  private readonly userId: string;
  private readonly tenantId: TenantId;
  private readonly provider: FederatedProviderId;
  private readonly externalSubjectId: string;
  private readonly externalEmail: Email;
  private readonly createdAt: Date;
  private readonly updatedAt: Date;

  private constructor(props: ReconstituteFederatedIdentityProps) {
    this.validateId(props.id);
    this.validateUserId(props.userId);
    this.validateProvider(props.provider);
    this.validateExternalSubjectId(props.externalSubjectId);

    this.id = props.id.trim();
    this.userId = props.userId.trim();
    this.tenantId = props.tenantId;
    this.provider = props.provider;
    this.externalSubjectId = props.externalSubjectId.trim();
    this.externalEmail = props.externalEmail;
    this.createdAt = new Date(props.createdAt.getTime());
    this.updatedAt = new Date(props.updatedAt.getTime());
  }

  public static create(props: CreateFederatedIdentityProps): FederatedIdentity {
    const id = props.id || crypto.randomUUID();
    const tenantId = props.tenantId instanceof TenantId ? props.tenantId : TenantId.create(props.tenantId);
    const externalEmail = props.externalEmail instanceof Email ? props.externalEmail : Email.create(props.externalEmail);
    const now = new Date();

    return new FederatedIdentity({
      id,
      userId: props.userId,
      tenantId,
      provider: props.provider,
      externalSubjectId: props.externalSubjectId,
      externalEmail,
      createdAt: now,
      updatedAt: now,
    });
  }

  public static reconstitute(props: ReconstituteFederatedIdentityProps): FederatedIdentity {
    return new FederatedIdentity(props);
  }

  public getId(): string {
    return this.id;
  }

  public getUserId(): string {
    return this.userId;
  }

  public getTenantId(): TenantId {
    return this.tenantId;
  }

  public getProvider(): FederatedProviderId {
    return this.provider;
  }

  public getExternalSubjectId(): string {
    return this.externalSubjectId;
  }

  public getExternalEmail(): Email {
    return this.externalEmail;
  }

  public getCreatedAt(): Date {
    return new Date(this.createdAt.getTime());
  }

  public getUpdatedAt(): Date {
    return new Date(this.updatedAt.getTime());
  }

  public equals(other: unknown): boolean {
    if (!(other instanceof FederatedIdentity)) {
      return false;
    }
    return (
      this.provider === other.provider &&
      this.externalSubjectId === other.externalSubjectId
    );
  }

  private validateId(id: string): void {
    if (!id || typeof id !== 'string' || id.trim().length === 0) {
      throw new DomainValidationError('FederatedIdentity id must be a non-empty string');
    }
  }

  private validateUserId(userId: string): void {
    if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
      throw new DomainValidationError('userId must be a non-empty string');
    }
  }

  private validateProvider(provider: FederatedProviderId): void {
    if (provider !== 'google' && provider !== 'microsoft') {
      throw new DomainValidationError(`Invalid or unsupported federated provider: "${provider}"`);
    }
  }

  private validateExternalSubjectId(subjectId: string): void {
    if (!subjectId || typeof subjectId !== 'string' || subjectId.trim().length === 0) {
      throw new DomainValidationError('externalSubjectId must be a non-empty string');
    }
  }
}
