import { createHash } from 'crypto';
import {
  KycMinLevel,
  TenantAllowedAuthMethods,
  TenantPolicy,
} from '../../../domain/entities/tenant_policy/entity';
import { TenantPolicyRepositoryPort } from '../../../domain/ports/tenant_policy_repository_port';
import { TenantId } from '../../../domain/value_objects/tenant_id/value';
import { CacheProviderPort } from '../../ports/cache/cache_provider';
import {
  FederatedProviderSummary,
  TenantFederatedProvidersPort,
} from '../../ports/federation/tenant_federated_providers_port';
import {
  ResolveClientTenantContextQuery,
  ResolveClientTenantContextQueryHandler,
} from '../resolve_client_tenant_context/handler';

export const AUTH_CONFIG_CACHE_TTL_SECONDS = 60;

export interface PublicAuthConfigDTO {
  readonly bindingId: string;
  readonly clientId: string;
  readonly tenantId: string;
  readonly customDomain: string | null;
  readonly allowedRedirectUris: readonly string[];
  readonly allowedCorsOrigins: readonly string[];
  readonly requiredFields: readonly ('email' | 'password' | 'phone')[];
  readonly allowedAuthMethods: TenantAllowedAuthMethods;
  readonly federatedProviders: readonly FederatedProviderSummary[];
  readonly kycRequired: boolean;
  readonly kycMinLevel: KycMinLevel;
}

export interface PublicAuthConfigResult {
  readonly dto: PublicAuthConfigDTO;
  readonly etag: string;
}

function authConfigVersionKey(tenantId: string): string {
  return `auth_config_ver:${tenantId}`;
}

function authConfigEntryKey(clientId: string, tenantId: string, version: string): string {
  return `auth_config:${clientId}:${tenantId}:v${version}`;
}

/**
 * Invalida en O(1) todas las entradas cacheadas de /api/v1/auth/config para un tenant
 * incrementando su token de versión.
 */
export async function invalidateAuthConfigCacheForTenant(
  cache: CacheProviderPort | undefined,
  tenantId: string
): Promise<void> {
  if (!cache || !tenantId.trim()) return;
  const nextVersion = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await cache.set(authConfigVersionKey(tenantId.trim()), nextVersion, 86400);
}

/**
 * Query Handler: GetPublicAuthConfig (US-31)
 * Valida el binding (US-29) de forma fail-closed y proyecta TenantPolicy (US-30) + proveedores OIDC
 * sin exponer secretos, con caché corta de 60s y ETag.
 */
export class GetPublicAuthConfigQueryHandler {
  constructor(
    private readonly resolveContextHandler: ResolveClientTenantContextQueryHandler,
    private readonly policyRepository: TenantPolicyRepositoryPort,
    private readonly federatedProvidersPort: TenantFederatedProvidersPort,
    private readonly cacheProvider?: CacheProviderPort
  ) {}

  public async execute(query: ResolveClientTenantContextQuery): Promise<PublicAuthConfigResult> {
    const resolved = await this.resolveContextHandler.execute(query);

    let version = '1';
    if (this.cacheProvider) {
      const cachedVersion = await this.cacheProvider.get<string>(
        authConfigVersionKey(resolved.tenantId)
      );
      if (cachedVersion) {
        version = cachedVersion;
      }

      const cached = await this.cacheProvider.get<PublicAuthConfigResult>(
        authConfigEntryKey(resolved.clientId, resolved.tenantId, version)
      );
      if (cached) {
        return cached;
      }
    }

    const tenantIdVo = TenantId.create(resolved.tenantId);
    const persistedPolicy = await this.policyRepository.findByTenantId(tenantIdVo);
    const policy = persistedPolicy ?? TenantPolicy.defaultFor(tenantIdVo);

    const requiredAttributes = policy.getRequiredAttributes();
    const kycPolicy = policy.getKycPolicy();
    const allowedAuthMethods = policy.getAllowedAuthMethods();

    const requiredFields: ('email' | 'password' | 'phone')[] = requiredAttributes.phone
      ? ['email', 'password', 'phone']
      : ['email', 'password'];

    const federatedProviders = allowedAuthMethods.federatedOidc
      ? await this.federatedProvidersPort.listForTenant(resolved.tenantId)
      : [];

    const dto: PublicAuthConfigDTO = {
      bindingId: resolved.bindingId,
      clientId: resolved.clientId,
      tenantId: resolved.tenantId,
      customDomain: resolved.customDomain,
      allowedRedirectUris: resolved.allowedRedirectUris,
      allowedCorsOrigins: resolved.allowedCorsOrigins,
      requiredFields,
      allowedAuthMethods,
      federatedProviders,
      kycRequired: kycPolicy.required,
      kycMinLevel: kycPolicy.minLevel,
    };

    const etag = createHash('sha256').update(JSON.stringify(dto)).digest('hex').slice(0, 24);
    const result: PublicAuthConfigResult = { dto, etag };

    if (this.cacheProvider) {
      await this.cacheProvider.set(
        authConfigEntryKey(resolved.clientId, resolved.tenantId, version),
        result,
        AUTH_CONFIG_CACHE_TTL_SECONDS
      );
    }

    return result;
  }
}
