import { ClientId } from '../../value_objects/client_id/value';
import { ClientSecret } from '../../value_objects/client_secret/value';
import { OriginDomain } from '../../value_objects/origin_domain/value';
import { GrantType } from '../../value_objects/grant_type/value';
import { Scope } from '../../value_objects/scope/value';
import { DomainValidationError } from '../../exceptions/user/error';
import { OAuth2AuthenticationError } from '../../exceptions/oauth2/error';

export type ClientType = 'confidential' | 'public';

export interface CreateClientApplicationProps {
  id: string;
  clientId: ClientId;
  clientSecretHash?: string | null;
  clientName: string;
  clientType: ClientType;
  allowedOrigins: OriginDomain[];
  redirectUris: string[];
  allowedGrantTypes: (GrantType | string)[];
  scopes: (Scope | string)[];
  isActive?: boolean;
}

export interface ReconstituteClientApplicationProps extends CreateClientApplicationProps {
  createdAt: Date;
  updatedAt: Date;
}

interface InternalClientApplicationProps {
  id: string;
  clientId: ClientId;
  clientSecretHash: string | null;
  clientName: string;
  clientType: ClientType;
  allowedOrigins: OriginDomain[];
  redirectUris: string[];
  allowedGrantTypes: GrantType[];
  scopes: Scope[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Aggregate Root: ClientApplication
 * Representa una aplicación cliente registrada (confidencial o pública) con sus permisos, concesiones y orígenes homologados.
 */
export class ClientApplication {
  private readonly id: string;
  private readonly clientId: ClientId;
  private readonly clientSecretHash: string | null;
  private clientName: string;
  private readonly clientType: ClientType;
  private allowedOrigins: OriginDomain[];
  private redirectUris: string[];
  private allowedGrantTypes: GrantType[];
  private scopes: Scope[];
  private active: boolean;
  private readonly createdAt: Date;
  private updatedAt: Date;

  private constructor(props: InternalClientApplicationProps) {
    this.id = props.id;
    this.clientId = props.clientId;
    this.clientSecretHash = props.clientSecretHash;
    this.clientName = props.clientName;
    this.clientType = props.clientType;
    this.allowedOrigins = [...props.allowedOrigins];
    this.redirectUris = [...props.redirectUris];
    this.allowedGrantTypes = [...props.allowedGrantTypes];
    this.scopes = [...props.scopes];
    this.active = props.isActive;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  public static create(props: CreateClientApplicationProps): ClientApplication {
    const normalized = ClientApplication.normalizeAndValidateInvariants(props);
    const now = new Date();

    return new ClientApplication({
      ...normalized,
      createdAt: now,
      updatedAt: now,
    });
  }

  public static reconstitute(props: ReconstituteClientApplicationProps): ClientApplication {
    const normalized = ClientApplication.normalizeAndValidateInvariants(props);

    return new ClientApplication({
      ...normalized,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
    });
  }

  private static normalizeAndValidateInvariants(
    props: CreateClientApplicationProps
  ): Omit<InternalClientApplicationProps, 'createdAt' | 'updatedAt'> {
    if (!props.id || props.id.trim().length === 0) {
      throw new DomainValidationError('ClientApplication id cannot be empty');
    }

    if (!props.clientName || props.clientName.trim().length === 0) {
      throw new DomainValidationError('ClientApplication name cannot be empty');
    }

    if (!props.allowedOrigins || props.allowedOrigins.length === 0) {
      throw new DomainValidationError('Client applications must specify at least one allowed origin');
    }

    const grantTypeVOs = (props.allowedGrantTypes || []).map((g) =>
      g instanceof GrantType ? g : GrantType.create(g)
    );

    const scopeVOs = (props.scopes || []).map((s) =>
      s instanceof Scope ? s : Scope.create(s)
    );

    if (props.clientType === 'public') {
      if (
        props.clientSecretHash !== undefined &&
        props.clientSecretHash !== null &&
        props.clientSecretHash.trim().length > 0
      ) {
        throw new DomainValidationError('Public client applications cannot possess a client_secret');
      }

      if (grantTypeVOs.some((g) => g.getValue() === 'client_credentials')) {
        throw new DomainValidationError(
          'Public client applications cannot be granted client_credentials flow'
        );
      }
    } else if (props.clientType === 'confidential') {
      if (!props.clientSecretHash || props.clientSecretHash.trim().length === 0) {
        throw new DomainValidationError('Confidential client applications must provide a client_secret_hash');
      }
    } else {
      throw new DomainValidationError(
        `Invalid client_type: "${props.clientType}". Must be "confidential" or "public".`
      );
    }

    return {
      id: props.id,
      clientId: props.clientId,
      clientSecretHash: props.clientSecretHash ?? null,
      clientName: props.clientName,
      clientType: props.clientType,
      allowedOrigins: [...props.allowedOrigins],
      redirectUris: [...(props.redirectUris || [])],
      allowedGrantTypes: grantTypeVOs,
      scopes: scopeVOs,
      isActive: props.isActive ?? true,
    };
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
    return [...this.allowedOrigins];
  }

  public getRedirectUris(): string[] {
    return [...this.redirectUris];
  }

  public getAllowedGrantTypes(): string[] {
    return this.allowedGrantTypes.map((g) => g.getValue());
  }

  public getAllowedGrantTypeVOs(): GrantType[] {
    return [...this.allowedGrantTypes];
  }

  public getScopes(): string[] {
    return this.scopes.map((s) => s.getValue());
  }

  public getScopeVOs(): Scope[] {
    return [...this.scopes];
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

  public hasGrantType(rawGrant: GrantType | string): boolean {
    let targetGrant: GrantType;
    try {
      targetGrant = typeof rawGrant === 'string' ? GrantType.create(rawGrant) : rawGrant;
    } catch {
      return false;
    }

    return this.allowedGrantTypes.some((g) => g.equals(targetGrant));
  }

  public hasScope(rawScope: Scope | string): boolean {
    let targetScope: Scope;
    try {
      targetScope = typeof rawScope === 'string' ? Scope.create(rawScope) : rawScope;
    } catch {
      return false;
    }

    return this.scopes.some((s) => s.equals(targetScope));
  }

  public activate(): void {
    this.active = true;
    this.updatedAt = new Date();
  }

  public deactivate(): void {
    this.active = false;
    this.updatedAt = new Date();
  }

  /**
   * Valida la concesión de Client Credentials (RFC 6749 Sección 4.4) verificando que el cliente
   * esté activo, sea de tipo confidencial, tenga habilitado el flujo y sus credenciales coincidan.
   */
  public async validateClientCredentialsGrant(
    secret: ClientSecret | undefined,
    secretVerifier: { compare(plainSecret: string, hashedSecret: string): Promise<boolean> }
  ): Promise<void> {
    if (!this.active) {
      throw new OAuth2AuthenticationError(
        'invalid_client',
        `Client application "${this.clientId.getValue()}" is currently deactivated`,
        401
      );
    }

    if (this.clientType === 'public') {
      throw new OAuth2AuthenticationError(
        'unauthorized_client',
        'Public clients are not authorized to use client_credentials grant type',
        400
      );
    }

    if (!this.hasGrantType('client_credentials')) {
      throw new OAuth2AuthenticationError(
        'unauthorized_client',
        `Client application "${this.clientId.getValue()}" is not authorized for client_credentials flow`,
        400
      );
    }

    if (!secret) {
      throw new OAuth2AuthenticationError(
        'invalid_client',
        'Client authentication failed: missing client_secret',
        401
      );
    }

    if (!this.clientSecretHash) {
      throw new OAuth2AuthenticationError(
        'invalid_client',
        'Client authentication failed: secret hash is missing from client registration',
        401
      );
    }

    const isMatch = await secretVerifier.compare(secret.getValue(), this.clientSecretHash);
    if (!isMatch) {
      throw new OAuth2AuthenticationError(
        'invalid_client',
        'Client authentication failed: invalid client credentials',
        401
      );
    }
  }

  /**
   * Filtra y autoriza scopes solicitados contra la lista de scopes homologados para este cliente.
   * Si no se especifican scopes, se autorizan todos los scopes registrados por defecto.
   */
  public filterAuthorizedScopes(requestedScopes?: string[]): {
    authorized: boolean;
    grantedScopes: string[];
    unauthorizedScope?: string;
  } {
    if (!requestedScopes || requestedScopes.length === 0) {
      return {
        authorized: true,
        grantedScopes: this.getScopes(),
      };
    }

    for (const scope of requestedScopes) {
      if (!this.hasScope(scope)) {
        return {
          authorized: false,
          grantedScopes: [],
          unauthorizedScope: scope,
        };
      }
    }

    return {
      authorized: true,
      grantedScopes: [...requestedScopes],
    };
  }
}
