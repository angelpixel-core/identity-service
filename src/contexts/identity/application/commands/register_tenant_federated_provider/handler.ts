import crypto from 'crypto';
import {
  FederatedProviderProtocol,
  SafeTenantFederatedProviderDto,
  TenantFederatedProvider,
  normalizeProviderKey,
} from '../../../domain/entities/tenant_federated_provider/entity';
import { DomainValidationError } from '../../../domain/exceptions/user/error';
import { OAuth2AuthenticationError } from '../../../domain/exceptions/oauth2/error';
import { TenantFederatedProviderRepositoryPort } from '../../../domain/ports/repositories/tenant_federated_provider_repository_port';
import { SecretCipherPort } from '../../../domain/ports/security/secret_cipher_port';
import { TenantId } from '../../../domain/value_objects/tenant_id/value';
import { InMemorySecurityAuditLogger } from '../../../infrastructure/logging/memory_security_audit_logger';
import { CacheProviderPort } from '../../ports/cache/cache_provider';
import { SecurityAuditLoggerPort } from '../../ports/security/audit_logger';
import { invalidateAuthConfigCacheForTenant } from '../../queries/get_public_auth_config/handler';

export interface RegisterTenantFederatedProviderCommand {
  readonly targetTenantId: string;
  readonly callerTenantId: string;
  readonly callerRoles?: readonly string[];
  readonly isRootOperator?: boolean;
  readonly actorId: string;
  readonly providerKey: string;
  readonly displayName: string;
  readonly protocol: FederatedProviderProtocol;
  readonly issuerUrl: string;
  readonly authorizationEndpoint?: string | null;
  readonly tokenEndpoint?: string | null;
  readonly jwksUri?: string | null;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly scopes?: readonly string[];
  readonly enabled?: boolean;
}

export interface RegisterTenantFederatedProviderResult {
  readonly created: boolean;
  readonly provider: SafeTenantFederatedProviderDto;
}

export function assertCanManageTenantFederation(params: {
  targetTenantId: string;
  callerTenantId: string;
  callerRoles?: readonly string[];
  isRootOperator?: boolean;
}): void {
  const roles = params.callerRoles ?? [];
  const isTenantAdmin =
    params.targetTenantId === params.callerTenantId &&
    (roles.includes('tenant_admin') || roles.includes('admin'));

  if (!params.isRootOperator && !isTenantAdmin) {
    throw new OAuth2AuthenticationError(
      'access_denied',
      `Forbidden: tenant_admin or system:superadmin role required to manage federated providers for "${params.targetTenantId}"`,
      403
    );
  }
}

/**
 * Command Handler: RegisterTenantFederatedProvider (US-33)
 */
export class RegisterTenantFederatedProviderCommandHandler {
  constructor(
    private readonly repository: TenantFederatedProviderRepositoryPort,
    private readonly secretCipher: SecretCipherPort,
    private readonly auditLogger: SecurityAuditLoggerPort = new InMemorySecurityAuditLogger(),
    private readonly cacheProvider?: CacheProviderPort
  ) {}

  public async execute(
    cmd: RegisterTenantFederatedProviderCommand
  ): Promise<RegisterTenantFederatedProviderResult> {
    const targetTenant = TenantId.create(cmd.targetTenantId);
    assertCanManageTenantFederation({
      targetTenantId: targetTenant.getValue(),
      callerTenantId: cmd.callerTenantId,
      callerRoles: cmd.callerRoles,
      isRootOperator: cmd.isRootOperator,
    });

    const providerKey = normalizeProviderKey(cmd.providerKey);
    const existing = await this.repository.findByTenantAndKey(targetTenant, providerKey);

    let encryptedSecret: string;
    const rawSecret = cmd.clientSecret?.trim();
    if (rawSecret) {
      encryptedSecret = this.secretCipher.encrypt(rawSecret);
    } else if (existing) {
      encryptedSecret = existing.getEncryptedClientSecret();
    } else {
      throw new DomainValidationError('clientSecret is required when registering a new provider');
    }

    let provider: TenantFederatedProvider;
    const created = !existing;
    if (existing) {
      existing.update({
        displayName: cmd.displayName,
        protocol: cmd.protocol,
        issuerUrl: cmd.issuerUrl,
        authorizationEndpoint: cmd.authorizationEndpoint,
        tokenEndpoint: cmd.tokenEndpoint,
        jwksUri: cmd.jwksUri,
        clientId: cmd.clientId,
        encryptedClientSecret: encryptedSecret,
        scopes: cmd.scopes,
        enabled: cmd.enabled,
      });
      provider = existing;
    } else {
      provider = TenantFederatedProvider.create({
        id: crypto.randomUUID(),
        tenantId: targetTenant,
        providerKey,
        displayName: cmd.displayName,
        protocol: cmd.protocol,
        issuerUrl: cmd.issuerUrl,
        authorizationEndpoint: cmd.authorizationEndpoint,
        tokenEndpoint: cmd.tokenEndpoint,
        jwksUri: cmd.jwksUri,
        clientId: cmd.clientId,
        encryptedClientSecret: encryptedSecret,
        scopes: cmd.scopes,
        enabled: cmd.enabled,
      });
    }

    await this.repository.save(provider);
    await invalidateAuthConfigCacheForTenant(this.cacheProvider, targetTenant.getValue());

    await this.auditLogger.logEvent({
      eventType: 'TENANT_IDP_REGISTERED',
      severity: 'INFO',
      status: 'SUCCESS',
      tenantId: targetTenant.getValue(),
      actor: {
        userId: cmd.actorId,
        type: cmd.isRootOperator ? 'OPERATOR' : 'USER',
      },
      timestamp: new Date(),
      details: {
        providerKey,
        protocol: provider.getProtocol(),
        issuerUrl: provider.getIssuerUrl(),
        clientId: provider.getClientId(),
        clientSecret: '[REDACTED]',
        created,
      },
    });

    if (cmd.isRootOperator && cmd.callerTenantId !== targetTenant.getValue()) {
      await this.auditLogger.logEvent({
        eventType: 'PLATFORM_OPERATOR_CROSS_TENANT_ACTION',
        severity: 'WARN',
        status: 'SUCCESS',
        tenantId: targetTenant.getValue(),
        actor: { userId: cmd.actorId, type: 'OPERATOR' },
        timestamp: new Date(),
        details: {
          action: 'REGISTER_TENANT_FEDERATED_PROVIDER',
          targetTenantId: targetTenant.getValue(),
          providerKey,
        },
      });
    }

    return {
      created,
      provider: provider.toSafeDto(),
    };
  }
}
