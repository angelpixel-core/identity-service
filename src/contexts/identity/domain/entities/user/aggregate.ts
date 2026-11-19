import crypto from 'crypto';
import { Email } from '../../value_objects/email/value';
import { TenantId } from '../../value_objects/tenant_id/value';
import { DomainValidationError } from '../../exceptions/user/error';

export interface UserCreateProps {
  id: string;
  email: Email;
  tenantId: TenantId;
  passwordHash: string;
  roles?: string[];
}

export interface FederatedUserCreateProps {
  id?: string;
  email: Email;
  tenantId: TenantId;
  roles?: string[];
}

export interface UserReconstituteProps {
  id: string;
  email: Email;
  tenantId: TenantId;
  passwordHash: string;
  roles?: string[];
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
  private readonly roles: readonly string[];
  private readonly createdAt: Date;
  private updatedAt: Date;

  private constructor(props: UserReconstituteProps) {
    this.validateId(props.id);
    this.validatePasswordHash(props.passwordHash);

    this.id = props.id.trim();
    this.email = props.email;
    this.tenantId = props.tenantId;
    this.passwordHash = props.passwordHash.trim();
    const rawRoles = props.roles && props.roles.length > 0 ? props.roles : ['member'];
    this.roles = Object.freeze(
      rawRoles
        .map((r) => r.trim().toLowerCase())
        .filter((r) => r.length > 0)
    );
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
      roles: props.roles,
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
      roles: props.roles,
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

  public getRoles(): string[] {
    return [...this.roles];
  }

  public hasRole(role: string): boolean {
    if (!role || typeof role !== 'string') {
      return false;
    }
    return this.roles.includes(role.trim().toLowerCase());
  }

  public isSuperadmin(): boolean {
    return this.tenantId.isRoot() && this.hasRole('superadmin');
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

