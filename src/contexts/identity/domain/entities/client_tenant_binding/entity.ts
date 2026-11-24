import { ClientId } from '../../value_objects/client_id/value';
import { TenantId } from '../../value_objects/tenant_id/value';
import { OriginDomain } from '../../value_objects/origin_domain/value';
import { DomainValidationError } from '../../exceptions/user/error';

export interface CreateClientTenantBindingProps {
  id: string;
  clientId: ClientId;
  tenantId: TenantId;
  customDomain?: string | null;
  allowedRedirectUris?: string[];
  allowedCorsOrigins?: (OriginDomain | string)[];
  isActive?: boolean;
}

export interface ReconstituteClientTenantBindingProps extends CreateClientTenantBindingProps {
  createdAt: Date;
  updatedAt: Date;
}

const HOSTNAME_REGEX =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$|^localhost$/;

export function normalizeCustomDomain(raw?: string | null): string | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  if (trimmed.includes('://') || trimmed.includes('/') || trimmed.includes(':')) {
    throw new DomainValidationError(
      `Invalid customDomain "${raw}": must be a hostname without protocol, port, or path`
    );
  }
  if (!HOSTNAME_REGEX.test(trimmed)) {
    throw new DomainValidationError(`Invalid customDomain hostname "${raw}"`);
  }
  return trimmed;
}

/**
 * Entidad de Dominio: ClientTenantBinding (US-29)
 * Modela la vinculación N:M explícita entre un ClientApplication, un Tenant y un dominio custom opcional.
 */
export class ClientTenantBinding {
  private readonly id: string;
  private readonly clientId: ClientId;
  private readonly tenantId: TenantId;
  private customDomain: string | null;
  private allowedRedirectUris: string[];
  private allowedCorsOrigins: OriginDomain[];
  private active: boolean;
  private readonly createdAt: Date;
  private updatedAt: Date;

  private constructor(params: {
    id: string;
    clientId: ClientId;
    tenantId: TenantId;
    customDomain: string | null;
    allowedRedirectUris: string[];
    allowedCorsOrigins: OriginDomain[];
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    this.id = params.id;
    this.clientId = params.clientId;
    this.tenantId = params.tenantId;
    this.customDomain = params.customDomain;
    this.allowedRedirectUris = [...params.allowedRedirectUris];
    this.allowedCorsOrigins = [...params.allowedCorsOrigins];
    this.active = params.isActive;
    this.createdAt = params.createdAt;
    this.updatedAt = params.updatedAt;
  }

  public static create(props: CreateClientTenantBindingProps): ClientTenantBinding {
    if (!props.id || !props.id.trim()) {
      throw new DomainValidationError('ClientTenantBinding id cannot be empty');
    }
    const now = new Date();
    return new ClientTenantBinding({
      id: props.id.trim(),
      clientId: props.clientId,
      tenantId: props.tenantId,
      customDomain: normalizeCustomDomain(props.customDomain),
      allowedRedirectUris: (props.allowedRedirectUris ?? [])
        .map((u) => u.trim())
        .filter(Boolean),
      allowedCorsOrigins: (props.allowedCorsOrigins ?? []).map((o) =>
        o instanceof OriginDomain ? o : OriginDomain.create(o)
      ),
      isActive: props.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    });
  }

  public static reconstitute(props: ReconstituteClientTenantBindingProps): ClientTenantBinding {
    return new ClientTenantBinding({
      id: props.id.trim(),
      clientId: props.clientId,
      tenantId: props.tenantId,
      customDomain: normalizeCustomDomain(props.customDomain),
      allowedRedirectUris: (props.allowedRedirectUris ?? [])
        .map((u) => u.trim())
        .filter(Boolean),
      allowedCorsOrigins: (props.allowedCorsOrigins ?? []).map((o) =>
        o instanceof OriginDomain ? o : OriginDomain.create(o)
      ),
      isActive: props.isActive ?? true,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
    });
  }

  public getId(): string {
    return this.id;
  }

  public getClientId(): ClientId {
    return this.clientId;
  }

  public getTenantId(): TenantId {
    return this.tenantId;
  }

  public getCustomDomain(): string | null {
    return this.customDomain;
  }

  public getAllowedRedirectUris(): string[] {
    return [...this.allowedRedirectUris];
  }

  public getAllowedCorsOrigins(): OriginDomain[] {
    return [...this.allowedCorsOrigins];
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

  public matchesRedirectUri(uri: string): boolean {
    if (!uri || typeof uri !== 'string') {
      return false;
    }
    return this.allowedRedirectUris.includes(uri.trim());
  }

  public matchesCorsOrigin(rawOrigin: OriginDomain | string): boolean {
    if (this.allowedCorsOrigins.length === 0) {
      return false;
    }
    let target: OriginDomain;
    try {
      target = typeof rawOrigin === 'string' ? OriginDomain.create(rawOrigin) : rawOrigin;
    } catch {
      return false;
    }
    return this.allowedCorsOrigins.some((allowed) => allowed.equals(target));
  }

  public activate(): void {
    this.active = true;
    this.updatedAt = new Date();
  }

  public deactivate(): void {
    this.active = false;
    this.updatedAt = new Date();
  }

  public update(patch: {
    customDomain?: string | null;
    allowedRedirectUris?: string[];
    allowedCorsOrigins?: (OriginDomain | string)[];
    isActive?: boolean;
  }): void {
    if (patch.customDomain !== undefined) {
      this.customDomain = normalizeCustomDomain(patch.customDomain);
    }
    if (patch.allowedRedirectUris !== undefined) {
      this.allowedRedirectUris = patch.allowedRedirectUris
        .map((u) => u.trim())
        .filter(Boolean);
    }
    if (patch.allowedCorsOrigins !== undefined) {
      this.allowedCorsOrigins = patch.allowedCorsOrigins.map((o) =>
        o instanceof OriginDomain ? o : OriginDomain.create(o)
      );
    }
    if (patch.isActive !== undefined) {
      this.active = patch.isActive;
    }
    this.updatedAt = new Date();
  }
}
