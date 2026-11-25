import { TenantId } from '../../value_objects/tenant_id/value';
import { DomainValidationError } from '../../exceptions/user/error';

export type FederatedProviderProtocol = 'oidc' | 'oauth2';

export interface CreateTenantFederatedProviderProps {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly providerKey: string;
  readonly displayName: string;
  readonly protocol: FederatedProviderProtocol;
  readonly issuerUrl: string;
  readonly authorizationEndpoint?: string | null;
  readonly tokenEndpoint?: string | null;
  readonly jwksUri?: string | null;
  readonly clientId: string;
  readonly encryptedClientSecret: string;
  readonly scopes?: readonly string[];
  readonly enabled?: boolean;
}

export interface ReconstituteTenantFederatedProviderProps
  extends CreateTenantFederatedProviderProps {
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SafeTenantFederatedProviderDto {
  readonly id: string;
  readonly tenantId: string;
  readonly providerKey: string;
  readonly displayName: string;
  readonly protocol: FederatedProviderProtocol;
  readonly issuerUrl: string;
  readonly authorizationEndpoint: string | null;
  readonly tokenEndpoint: string | null;
  readonly jwksUri: string | null;
  readonly clientId: string;
  readonly hasClientSecret: true;
  readonly scopes: readonly string[];
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const PROVIDER_KEY_REGEX = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

export function normalizeProviderKey(raw: string): string {
  const normalized = raw.trim().toLowerCase();
  if (!PROVIDER_KEY_REGEX.test(normalized)) {
    throw new DomainValidationError(
      `Invalid providerKey "${raw}": must be 3-64 lowercase alphanumeric/hyphen characters`
    );
  }
  return normalized;
}

export function validateProviderUrl(raw: string, fieldName: string): string {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new DomainValidationError(`Invalid ${fieldName} "${raw}": must be a valid URL`);
  }
  const isLocalHttp =
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
  if (parsed.protocol !== 'https:' && !isLocalHttp) {
    throw new DomainValidationError(
      `Invalid ${fieldName} "${raw}": must use https:// (or http://localhost in dev/test)`
    );
  }
  return trimmed;
}

function normalizeOptionalUrl(raw: string | null | undefined, fieldName: string): string | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return validateProviderUrl(trimmed, fieldName);
}

/**
 * Entidad de Dominio: TenantFederatedProvider (US-33)
 * Modela un proveedor OIDC/OAuth2 configurado por inquilino con secreto cifrado en reposo.
 */
export class TenantFederatedProvider {
  private readonly id: string;
  private readonly tenantId: TenantId;
  private readonly providerKey: string;
  private displayName: string;
  private protocol: FederatedProviderProtocol;
  private issuerUrl: string;
  private authorizationEndpoint: string | null;
  private tokenEndpoint: string | null;
  private jwksUri: string | null;
  private clientId: string;
  private encryptedClientSecret: string;
  private scopes: string[];
  private enabled: boolean;
  private readonly createdAt: Date;
  private updatedAt: Date;

  private constructor(params: {
    id: string;
    tenantId: TenantId;
    providerKey: string;
    displayName: string;
    protocol: FederatedProviderProtocol;
    issuerUrl: string;
    authorizationEndpoint: string | null;
    tokenEndpoint: string | null;
    jwksUri: string | null;
    clientId: string;
    encryptedClientSecret: string;
    scopes: string[];
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    this.id = params.id;
    this.tenantId = params.tenantId;
    this.providerKey = params.providerKey;
    this.displayName = params.displayName;
    this.protocol = params.protocol;
    this.issuerUrl = params.issuerUrl;
    this.authorizationEndpoint = params.authorizationEndpoint;
    this.tokenEndpoint = params.tokenEndpoint;
    this.jwksUri = params.jwksUri;
    this.clientId = params.clientId;
    this.encryptedClientSecret = params.encryptedClientSecret;
    this.scopes = params.scopes;
    this.enabled = params.enabled;
    this.createdAt = params.createdAt;
    this.updatedAt = params.updatedAt;
  }

  public static create(props: CreateTenantFederatedProviderProps): TenantFederatedProvider {
    const providerKey = normalizeProviderKey(props.providerKey);
    const displayName = props.displayName.trim();
    if (!displayName) {
      throw new DomainValidationError('displayName is required');
    }
    if (props.protocol !== 'oidc' && props.protocol !== 'oauth2') {
      throw new DomainValidationError(`Unsupported protocol "${String(props.protocol)}"`);
    }
    const issuerUrl = validateProviderUrl(props.issuerUrl, 'issuerUrl');
    const clientId = props.clientId.trim();
    if (!clientId) {
      throw new DomainValidationError('clientId is required');
    }
    if (!props.encryptedClientSecret.trim()) {
      throw new DomainValidationError('encryptedClientSecret is required');
    }
    const scopes =
      props.scopes && props.scopes.length > 0
        ? Array.from(new Set(props.scopes.map((s) => s.trim()).filter(Boolean)))
        : ['openid', 'email', 'profile'];
    const now = new Date();

    return new TenantFederatedProvider({
      id: props.id,
      tenantId: props.tenantId,
      providerKey,
      displayName,
      protocol: props.protocol,
      issuerUrl,
      authorizationEndpoint: normalizeOptionalUrl(
        props.authorizationEndpoint,
        'authorizationEndpoint'
      ),
      tokenEndpoint: normalizeOptionalUrl(props.tokenEndpoint, 'tokenEndpoint'),
      jwksUri: normalizeOptionalUrl(props.jwksUri, 'jwksUri'),
      clientId,
      encryptedClientSecret: props.encryptedClientSecret,
      scopes,
      enabled: props.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    });
  }

  public static reconstitute(
    props: ReconstituteTenantFederatedProviderProps
  ): TenantFederatedProvider {
    return new TenantFederatedProvider({
      id: props.id,
      tenantId: props.tenantId,
      providerKey: normalizeProviderKey(props.providerKey),
      displayName: props.displayName.trim(),
      protocol: props.protocol,
      issuerUrl: props.issuerUrl,
      authorizationEndpoint: props.authorizationEndpoint ?? null,
      tokenEndpoint: props.tokenEndpoint ?? null,
      jwksUri: props.jwksUri ?? null,
      clientId: props.clientId,
      encryptedClientSecret: props.encryptedClientSecret,
      scopes: [...(props.scopes ?? ['openid', 'email', 'profile'])],
      enabled: props.enabled ?? true,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
    });
  }

  public update(patch: {
    readonly displayName?: string;
    readonly protocol?: FederatedProviderProtocol;
    readonly issuerUrl?: string;
    readonly authorizationEndpoint?: string | null;
    readonly tokenEndpoint?: string | null;
    readonly jwksUri?: string | null;
    readonly clientId?: string;
    readonly encryptedClientSecret?: string;
    readonly scopes?: readonly string[];
    readonly enabled?: boolean;
  }): void {
    if (patch.displayName !== undefined) {
      const trimmed = patch.displayName.trim();
      if (!trimmed) throw new DomainValidationError('displayName cannot be empty');
      this.displayName = trimmed;
    }
    if (patch.protocol !== undefined) {
      if (patch.protocol !== 'oidc' && patch.protocol !== 'oauth2') {
        throw new DomainValidationError(`Unsupported protocol "${String(patch.protocol)}"`);
      }
      this.protocol = patch.protocol;
    }
    if (patch.issuerUrl !== undefined) {
      this.issuerUrl = validateProviderUrl(patch.issuerUrl, 'issuerUrl');
    }
    if (patch.authorizationEndpoint !== undefined) {
      this.authorizationEndpoint = normalizeOptionalUrl(
        patch.authorizationEndpoint,
        'authorizationEndpoint'
      );
    }
    if (patch.tokenEndpoint !== undefined) {
      this.tokenEndpoint = normalizeOptionalUrl(patch.tokenEndpoint, 'tokenEndpoint');
    }
    if (patch.jwksUri !== undefined) {
      this.jwksUri = normalizeOptionalUrl(patch.jwksUri, 'jwksUri');
    }
    if (patch.clientId !== undefined) {
      const trimmed = patch.clientId.trim();
      if (!trimmed) throw new DomainValidationError('clientId cannot be empty');
      this.clientId = trimmed;
    }
    if (patch.encryptedClientSecret !== undefined && patch.encryptedClientSecret.trim()) {
      this.encryptedClientSecret = patch.encryptedClientSecret;
    }
    if (patch.scopes !== undefined && patch.scopes.length > 0) {
      this.scopes = Array.from(new Set(patch.scopes.map((s) => s.trim()).filter(Boolean)));
    }
    if (patch.enabled !== undefined) {
      this.enabled = patch.enabled;
    }
    this.updatedAt = new Date();
  }

  public getId(): string {
    return this.id;
  }
  public getTenantId(): TenantId {
    return this.tenantId;
  }
  public getProviderKey(): string {
    return this.providerKey;
  }
  public getDisplayName(): string {
    return this.displayName;
  }
  public getProtocol(): FederatedProviderProtocol {
    return this.protocol;
  }
  public getIssuerUrl(): string {
    return this.issuerUrl;
  }
  public getAuthorizationEndpoint(): string | null {
    return this.authorizationEndpoint;
  }
  public getTokenEndpoint(): string | null {
    return this.tokenEndpoint;
  }
  public getJwksUri(): string | null {
    return this.jwksUri;
  }
  public getClientId(): string {
    return this.clientId;
  }
  public getEncryptedClientSecret(): string {
    return this.encryptedClientSecret;
  }
  public getScopes(): readonly string[] {
    return [...this.scopes];
  }
  public isEnabled(): boolean {
    return this.enabled;
  }
  public getCreatedAt(): Date {
    return this.createdAt;
  }
  public getUpdatedAt(): Date {
    return this.updatedAt;
  }

  public toSafeDto(): SafeTenantFederatedProviderDto {
    return {
      id: this.id,
      tenantId: this.tenantId.getValue(),
      providerKey: this.providerKey,
      displayName: this.displayName,
      protocol: this.protocol,
      issuerUrl: this.issuerUrl,
      authorizationEndpoint: this.authorizationEndpoint,
      tokenEndpoint: this.tokenEndpoint,
      jwksUri: this.jwksUri,
      clientId: this.clientId,
      hasClientSecret: true,
      scopes: [...this.scopes],
      enabled: this.enabled,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
