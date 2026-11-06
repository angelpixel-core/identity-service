import { ClientId } from '../../value_objects/client_id/value';
import { OriginDomain } from '../../value_objects/origin_domain/value';
import { DomainValidationError } from '../../exceptions/user/error';

export type ClientType = 'confidential' | 'public';

export interface CreateClientApplicationProps {
  id: string;
  clientId: ClientId;
  clientSecretHash?: string | null;
  clientName: string;
  clientType: ClientType;
  allowedOrigins: OriginDomain[];
  redirectUris: string[];
  allowedGrantTypes: string[];
  scopes: string[];
  isActive?: boolean;
}

export interface ReconstituteClientApplicationProps extends CreateClientApplicationProps {
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Aggregate Root: ClientApplication
 * Representa una aplicación cliente registrada (confidencial o pública) con sus permisos y orígenes homologados.
 */
export class ClientApplication {
  private readonly id: string;
  private readonly clientId: ClientId;
  private readonly clientSecretHash: string | null;
  private clientName: string;
  private readonly clientType: ClientType;
  private allowedOrigins: OriginDomain[];
  private redirectUris: string[];
  private allowedGrantTypes: string[];
  private scopes: string[];
  private active: boolean;
  private readonly createdAt: Date;
  private updatedAt: Date;

  private constructor(props: ReconstituteClientApplicationProps) {
    this.id = props.id;
    this.clientId = props.clientId;
    this.clientSecretHash = props.clientSecretHash ?? null;
    this.clientName = props.clientName;
    this.clientType = props.clientType;
    this.allowedOrigins = [...props.allowedOrigins];
    this.redirectUris = [...props.redirectUris];
    this.allowedGrantTypes = [...props.allowedGrantTypes];
    this.scopes = [...props.scopes];
    this.active = props.isActive ?? true;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  public static create(props: CreateClientApplicationProps): ClientApplication {
    ClientApplication.validateInvariants(props);

    const now = new Date();
    return new ClientApplication({
      ...props,
      clientSecretHash: props.clientSecretHash ?? null,
      isActive: props.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    });
  }

  public static reconstitute(props: ReconstituteClientApplicationProps): ClientApplication {
    ClientApplication.validateInvariants(props);
    return new ClientApplication(props);
  }

  private static validateInvariants(props: CreateClientApplicationProps): void {
    if (!props.id || props.id.trim().length === 0) {
      throw new DomainValidationError('ClientApplication id cannot be empty');
    }

    if (!props.clientName || props.clientName.trim().length === 0) {
      throw new DomainValidationError('ClientApplication name cannot be empty');
    }

    if (!props.allowedOrigins || props.allowedOrigins.length === 0) {
      throw new DomainValidationError('Client applications must specify at least one allowed origin');
    }

    if (props.clientType === 'public') {
      if (props.clientSecretHash !== undefined && props.clientSecretHash !== null && props.clientSecretHash.trim().length > 0) {
        throw new DomainValidationError('Public client applications cannot possess a client_secret');
      }
    } else if (props.clientType === 'confidential') {
      if (!props.clientSecretHash || props.clientSecretHash.trim().length === 0) {
        throw new DomainValidationError('Confidential client applications must provide a client_secret_hash');
      }
    } else {
      throw new DomainValidationError(`Invalid client_type: "${props.clientType}". Must be "confidential" or "public".`);
    }
  }

  public getId(): string {
    return this.id;
  }

  public getClientId(): ClientId {
    return this.clientId;
  }

  public getClientSecretHash(): string | null {
    return this.clientSecretHash;
  }

  public getClientName(): string {
    return this.clientName;
  }

  public getClientType(): ClientType {
    return this.clientType;
  }

  public getAllowedOrigins(): OriginDomain[] {
    return this.allowedOrigins;
  }

  public getRedirectUris(): string[] {
    return this.redirectUris;
  }

  public getAllowedGrantTypes(): string[] {
    return this.allowedGrantTypes;
  }

  public getScopes(): string[] {
    return this.scopes;
  }

  public isActive(): boolean {
    return this.active;
  }

  public getCreatedAt(): Date {
    return this.createdAt;
  }

  public getUpdatedAt(): Date {
    return this.updatedAt;
  }

  public isOriginAllowed(rawOrigin: OriginDomain | string): boolean {
    let targetOrigin: OriginDomain;
    try {
      targetOrigin = typeof rawOrigin === 'string' ? OriginDomain.create(rawOrigin) : rawOrigin;
    } catch {
      return false;
    }

    return this.allowedOrigins.some((allowed) => allowed.equals(targetOrigin));
  }

  public activate(): void {
    this.active = true;
    this.updatedAt = new Date();
  }

  public deactivate(): void {
    this.active = false;
    this.updatedAt = new Date();
  }
}