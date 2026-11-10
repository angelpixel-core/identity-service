import crypto from 'crypto';
import { Email } from '../../value_objects/email/value';
import { TenantId } from '../../value_objects/tenant_id/value';
import { DomainValidationError } from '../../exceptions/user/error';

export interface UserCreateProps {
  id: string;
  email: Email;
  tenantId: TenantId;
  passwordHash: string;
}

export interface FederatedUserCreateProps {
  id?: string;
  email: Email;
  tenantId: TenantId;
}

export interface UserReconstituteProps {
  id: string;
  email: Email;
  tenantId: TenantId;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Aggregate Root: User
 * Entidad central del Bounded Context Identity.
 * Controla sus invariantes, identidad única por tenant y transiciones de estado.
 */
export class User {
  private readonly id: string;
  private email: Email;
  private readonly tenantId: TenantId;
  private passwordHash: string;
  private readonly createdAt: Date;
  private updatedAt: Date;

  private constructor(props: UserReconstituteProps) {
    this.validateId(props.id);
    this.validatePasswordHash(props.passwordHash);

    this.id = props.id.trim();
    this.email = props.email;
    this.tenantId = props.tenantId;
    this.passwordHash = props.passwordHash.trim();
    this.createdAt = new Date(props.createdAt.getTime());
    this.updatedAt = new Date(props.updatedAt.getTime());
  }

  public static create(props: UserCreateProps): User {
    const now = new Date();
    return new User({
      id: props.id,
      email: props.email,
      tenantId: props.tenantId,
      passwordHash: props.passwordHash,
      createdAt: now,
      updatedAt: now,
    });
  }

  public static createFederatedUser(props: FederatedUserCreateProps): User {
    const id = props.id && props.id.trim().length > 0 ? props.id.trim() : crypto.randomUUID();
    const unmatchablePasswordHash = `$2b$12$FEDERATED_NO_LOCAL_PASSWORD_${crypto.randomUUID()}`;
    return User.create({
      id,
      email: props.email,
      tenantId: props.tenantId,
      passwordHash: unmatchablePasswordHash,
    });
  }

  public static reconstitute(props: UserReconstituteProps): User {
    return new User(props);
  }

  public getId(): string {
    return this.id;
  }

  public getEmail(): Email {
    return this.email;
  }

  public getTenantId(): TenantId {
    return this.tenantId;
  }

  public getPasswordHash(): string {
    return this.passwordHash;
  }

  public hasLocalPassword(): boolean {
    return !this.passwordHash.startsWith('$2b$12$FEDERATED_NO_LOCAL_PASSWORD_');
  }

  public getCreatedAt(): Date {
    return new Date(this.createdAt.getTime());
  }

  public getUpdatedAt(): Date {
    return new Date(this.updatedAt.getTime());
  }

  public changePassword(newPasswordHash: string): void {
    if (!newPasswordHash || typeof newPasswordHash !== 'string' || newPasswordHash.trim().length === 0) {
      throw new DomainValidationError('New password hash must be a non-empty string');
    }

    this.passwordHash = newPasswordHash.trim();
    this.updatedAt = new Date();
  }

  public updateEmail(newEmail: Email): void {
    if (!newEmail) {
      throw new DomainValidationError('New email must be provided');
    }

    this.email = newEmail;
    this.updatedAt = new Date();
  }

  private validateId(id: string): void {
    if (!id || typeof id !== 'string' || id.trim().length === 0) {
      throw new DomainValidationError('User id must be a non-empty string');
    }
  }

  private validatePasswordHash(hash: string): void {
    if (!hash || typeof hash !== 'string' || hash.trim().length === 0) {
      throw new DomainValidationError('Password hash must be a non-empty string');
    }
  }
}

