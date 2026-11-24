import { ClientId } from '../../value_objects/client_id/value';
import { ClientSecret } from '../../value_objects/client_secret/value';
import { OriginDomain } from '../../value_objects/origin_domain/value';
import { GrantType } from '../../value_objects/grant_type/value';
import { Scope } from '../../value_objects/scope/value';
import { DomainValidationError } from '../../exceptions/user/error';
import { OAuth2AuthenticationError } from '../../exceptions/oauth2/error';

export type ClientType = 'confidential' | 'public';
export type ClientProfile = 'spa' | 'web' | 'native' | 'm2m';
export type ClientStatus = 'active' | 'suspended';

export interface CreateClientApplicationProps {
  id: string;
  tenantId?: string;
  clientId: ClientId;
  clientSecretHash?: string | null;
  previousSecretHash?: string | null;
  secretGraceExpiresAt?: Date | null;
  clientName: string;
  clientType: ClientType;
  clientProfile?: ClientProfile;
  allowedOrigins: OriginDomain[];
  redirectUris: string[];
  allowedGrantTypes: (GrantType | string)[];
  scopes: (Scope | string)[];
  isActive?: boolean;
  status?: ClientStatus;
}

export interface ReconstituteClientApplicationProps extends CreateClientApplicationProps {
  createdAt: Date;
  updatedAt: Date;
}

interface InternalClientApplicationProps {
  id: string;
  tenantId: string;
  clientId: ClientId;
  clientSecretHash: string | null;
  previousSecretHash: string | null;
  secretGraceExpiresAt: Date | null;
  clientName: string;
  clientType: ClientType;
  clientProfile: ClientProfile;
  allowedOrigins: OriginDomain[];
  redirectUris: string[];
  allowedGrantTypes: GrantType[];
  scopes: Scope[];
  isActive: boolean;
  status: ClientStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Aggregate Root: ClientApplication
 * Representa una aplicación cliente registrada (confidencial o pública) con sus permisos, concesiones, ciclo de vida y rotación dual.
 */
export class ClientApplication {
  private readonly id: string;
  private readonly tenantId: string;
  private readonly clientId: ClientId;
  private clientSecretHash: string | null;
  private previousSecretHash: string | null;
  private secretGraceExpiresAt: Date | null;
  private clientName: string;
  private readonly clientType: ClientType;
  private readonly clientProfile: ClientProfile;
  private allowedOrigins: OriginDomain[];
  private redirectUris: string[];
  private allowedGrantTypes: GrantType[];
  private scopes: Scope[];
  private active: boolean;
  private status: ClientStatus;
  private readonly createdAt: Date;
  private updatedAt: Date;

  private constructor(props: InternalClientApplicationProps) {
    this.id = props.id;
    this.tenantId = props.tenantId;
    this.clientId = props.clientId;
    this.clientSecretHash = props.clientSecretHash;
    this.previousSecretHash = props.previousSecretHash;
    this.secretGraceExpiresAt = props.secretGraceExpiresAt;
    this.clientName = props.clientName;
    this.clientType = props.clientType;
    this.clientProfile = props.clientProfile;
    this.allowedOrigins = [...props.allowedOrigins];
    this.redirectUris = [...props.redirectUris];
    this.allowedGrantTypes = [...props.allowedGrantTypes];
    this.scopes = [...props.scopes];
    this.active = props.isActive;
    this.status = props.status;
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

    const defaultProfile: ClientProfile = props.clientType === 'confidential' ? 'm2m' : 'spa';
    const clientProfile = props.clientProfile ?? defaultProfile;
    const isActive =
      props.status !== undefined ? props.status === 'active' : (props.isActive ?? true);
    const status: ClientStatus = isActive ? 'active' : 'suspended';

    return {
      id: props.id,
      tenantId: props.tenantId?.trim() || 'acme-corp',
      clientId: props.clientId,
      clientSecretHash: props.clientSecretHash ?? null,
      previousSecretHash: props.previousSecretHash ?? null,
      secretGraceExpiresAt: props.secretGraceExpiresAt ?? null,
      clientName: props.clientName,
      clientType: props.clientType,
      clientProfile,
      allowedOrigins: [...props.allowedOrigins],
      redirectUris: [...(props.redirectUris || [])],
      allowedGrantTypes: grantTypeVOs,
      scopes: scopeVOs,
      isActive,
      status,
    };
  }

  public getId(): string {
    return this.id;
  }

  public getTenantId(): string {
    return this.tenantId;
  }

  public getClientId(): ClientId {
    return this.clientId;
  }

  public getClientSecretHash(): string | null {
    return this.clientSecretHash;
  }

  public getPreviousSecretHash(): string | null {
    return this.previousSecretHash;
  }

  public getSecretGraceExpiresAt(): Date | null {
    return this.secretGraceExpiresAt;
  }

  public getClientName(): string {
    return this.clientName;
  }

  public getClientType(): ClientType {
    return this.clientType;
  }

  public getClientProfile(): ClientProfile {
    return this.clientProfile;
  }

  public getStatus(): ClientStatus {
    return this.status;
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

  public isRedirectUriAllowed(redirectUri: string): boolean {
    if (!redirectUri || typeof redirectUri !== 'string') {
      return false;
    }
    const target = redirectUri.trim();
    return this.redirectUris.includes(target);
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
    this.status = 'active';
    this.updatedAt = new Date();
  }

  public deactivate(): void {
    this.active = false;
    this.status = 'suspended';
    this.updatedAt = new Date();
  }

  public suspend(): void {
    this.deactivate();
  }

  public reactivate(): void {
    this.activate();
  }

  public updateConfiguration(patch: {
    clientName?: string;
    allowedOrigins?: OriginDomain[];
    redirectUris?: string[];
    allowedGrantTypes?: (GrantType | string)[];
    scopes?: (Scope | string)[];
  }): void {
    if (patch.clientName !== undefined) {
      if (!patch.clientName.trim()) {
        throw new DomainValidationError('ClientApplication name cannot be empty');
      }
      this.clientName = patch.clientName.trim();
    }

    if (patch.allowedOrigins !== undefined) {
      if (patch.allowedOrigins.length === 0) {
        throw new DomainValidationError('Client applications must specify at least one allowed origin');
      }
      this.allowedOrigins = [...patch.allowedOrigins];
    }

    if (patch.redirectUris !== undefined) {
      this.redirectUris = [...patch.redirectUris];
    }

    if (patch.allowedGrantTypes !== undefined) {
      const grantTypeVOs = patch.allowedGrantTypes.map((g) =>
        g instanceof GrantType ? g : GrantType.create(g)
      );
      if (
        this.clientType === 'public' &&
        grantTypeVOs.some((g) => g.getValue() === 'client_credentials')
      ) {
        throw new DomainValidationError(
          'Public client applications cannot be granted client_credentials flow'
        );
      }
      this.allowedGrantTypes = grantTypeVOs;
    }

    if (patch.scopes !== undefined) {
      this.scopes = patch.scopes.map((s) => (s instanceof Scope ? s : Scope.create(s)));
    }

    this.updatedAt = new Date();
  }

  public rotateSecret(newSecretHash: string, gracePeriodSeconds = 0): void {
    if (this.clientType === 'public') {
      throw new OAuth2AuthenticationError(
        'invalid_client_operation',
        `Public client application "${this.clientId.getValue()}" cannot rotate client_secret`,
        400
      );
    }

    if (!newSecretHash || newSecretHash.trim().length === 0) {
      throw new DomainValidationError('New client_secret_hash cannot be empty');
    }

    if (gracePeriodSeconds < 0 || !Number.isFinite(gracePeriodSeconds)) {
      throw new DomainValidationError('gracePeriodSeconds must be a non-negative number');
    }

    const now = new Date();
    if (gracePeriodSeconds > 0 && this.clientSecretHash) {
      this.previousSecretHash = this.clientSecretHash;
      this.secretGraceExpiresAt = new Date(now.getTime() + gracePeriodSeconds * 1000);
    } else {
      this.previousSecretHash = null;
      this.secretGraceExpiresAt = null;
    }

    this.clientSecretHash = newSecretHash;
    this.updatedAt = now;
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

    const isCurrentMatch = await secretVerifier.compare(secret.getValue(), this.clientSecretHash);
    if (isCurrentMatch) {
      return;
    }

    const withinGraceWindow =
      this.previousSecretHash !== null &&
      this.secretGraceExpiresAt !== null &&
      new Date() < this.secretGraceExpiresAt;

    if (withinGraceWindow && this.previousSecretHash) {
      const isPreviousMatch = await secretVerifier.compare(
        secret.getValue(),
        this.previousSecretHash
      );
      if (isPreviousMatch) {
        return;
      }
    }

    throw new OAuth2AuthenticationError(
      'invalid_client',
      'Client authentication failed: invalid client credentials',
      401
    );
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
