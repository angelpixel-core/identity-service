import { randomUUID } from 'crypto';
import { WebAuthnCredential } from '../../../domain/entities/webauthn_credential/entity';
import { WebAuthnCredentialRepositoryPort } from '../../../domain/ports/webauthn_credential_repository_port';
import { TenantPolicy } from '../../../domain/entities/tenant_policy/entity';
import { TenantPolicyRepositoryPort } from '../../../domain/ports/tenant_policy_repository_port';
import { TenantId } from '../../../domain/value_objects/tenant_id/value';
import { OAuth2AuthenticationError } from '../../../domain/exceptions/oauth2/error';
import { DomainValidationError } from '../../../domain/exceptions/user/error';
import { CacheProviderPort } from '../../ports/cache/cache_provider';
import { SecurityAuditLoggerPort } from '../../ports/security/audit_logger';
import { WebAuthnVerifierPort } from '../../ports/security/webauthn_verifier_port';
import { ResolveClientTenantContextQueryHandler } from '../../queries/resolve_client_tenant_context/handler';
import { InMemorySecurityAuditLogger } from '../../../infrastructure/logging/memory_security_audit_logger';

const CHALLENGE_TTL_SECONDS = 300;

export interface PasskeySummaryDTO {
  readonly id: string;
  readonly credentialId: string;
  readonly deviceType: 'singleDevice' | 'multiDevice';
  readonly backedUp: boolean;
  readonly transports: readonly string[];
  readonly createdAt: string;
}

export function toPasskeySummaryDTO(cred: WebAuthnCredential): PasskeySummaryDTO {
  return {
    id: cred.getId(),
    credentialId: cred.getCredentialId(),
    deviceType: cred.getDeviceType(),
    backedUp: cred.isBackedUp(),
    transports: [...cred.getTransports()],
    createdAt: cred.getCreatedAt().toISOString(),
  };
}

interface StoredRegistrationChallenge {
  readonly challenge: string;
  readonly rpID: string;
  readonly expectedOrigins: string[];
  readonly clientId?: string;
}

function challengeCacheKey(tenantId: string, userId: string): string {
  return `webauthn_reg:${tenantId}:${userId}`;
}

function defaultWebAuthnRpId(): string {
  return (process.env.WEBAUTHN_RP_ID || 'localhost').trim();
}

function defaultWebAuthnOrigins(requestOrigin?: string): string[] {
  const configured = (process.env.WEBAUTHN_ORIGIN || 'http://localhost:3000').trim();
  const origins = [configured];
  if (requestOrigin && !origins.includes(requestOrigin)) {
    origins.push(requestOrigin);
  }
  return origins;
}

export interface BeginPasskeyRegistrationCommand {
  readonly userId: string;
  readonly email: string;
  readonly tenantId: string;
  readonly clientId?: string;
  readonly origin?: string;
  readonly ip?: string;
}

export class BeginPasskeyRegistrationCommandHandler {
  constructor(
    private readonly credentialRepository: WebAuthnCredentialRepositoryPort,
    private readonly policyRepository: TenantPolicyRepositoryPort,
    private readonly verifier: WebAuthnVerifierPort,
    private readonly cacheProvider: CacheProviderPort,
    private readonly resolveContextHandler?: ResolveClientTenantContextQueryHandler
  ) {}

  public async execute(
    cmd: BeginPasskeyRegistrationCommand
  ): Promise<Record<string, unknown> & { challenge: string }> {
    const tenantId = TenantId.create(cmd.tenantId);
    const persistedPolicy = await this.policyRepository.findByTenantId(tenantId);
    const policy = persistedPolicy ?? TenantPolicy.defaultFor(tenantId);

    if (!policy.getAllowedAuthMethods().passkeys) {
      throw new OAuth2AuthenticationError(
        'auth_method_disabled_for_tenant',
        `Passkeys are disabled for tenant "${tenantId.getValue()}"`,
        403
      );
    }

    let rpID = defaultWebAuthnRpId();
    let expectedOrigins = defaultWebAuthnOrigins(cmd.origin);

    if (cmd.clientId && this.resolveContextHandler) {
      const resolved = await this.resolveContextHandler.execute({
        clientId: cmd.clientId,
        tenantId: tenantId.getValue(),
        origin: cmd.origin,
        ip: cmd.ip,
      });
      if (resolved.customDomain) {
        rpID = resolved.customDomain;
      } else if (resolved.allowedCorsOrigins[0]) {
        rpID = new URL(resolved.allowedCorsOrigins[0]).hostname;
      }
      if (resolved.allowedCorsOrigins.length > 0) {
        expectedOrigins = [...resolved.allowedCorsOrigins];
      }
    } else if (cmd.origin) {
      try {
        rpID = new URL(cmd.origin).hostname;
      } catch {
        // fallback to defaultWebAuthnRpId()
      }
    }

    const existing = await this.credentialRepository.findByUserAndTenant(cmd.userId, tenantId);
    const options = await this.verifier.generateRegistrationOptions({
      rpName: `Identity Service (${tenantId.getValue()})`,
      rpID,
      userId: cmd.userId,
      userName: cmd.email,
      excludeCredentialIds: existing.map((c) => c.getCredentialId()),
    });

    const payload: StoredRegistrationChallenge = {
      challenge: options.challenge,
      rpID,
      expectedOrigins,
      clientId: cmd.clientId,
    };

    await this.cacheProvider.set(
      challengeCacheKey(tenantId.getValue(), cmd.userId),
      payload,
      CHALLENGE_TTL_SECONDS
    );

    return options;
  }
}

export interface VerifyPasskeyRegistrationCommand {
  readonly userId: string;
  readonly tenantId: string;
  readonly response: unknown;
  readonly clientId?: string;
  readonly origin?: string;
  readonly ip?: string;
}

export class VerifyPasskeyRegistrationCommandHandler {
  constructor(
    private readonly credentialRepository: WebAuthnCredentialRepositoryPort,
    private readonly policyRepository: TenantPolicyRepositoryPort,
    private readonly verifier: WebAuthnVerifierPort,
    private readonly cacheProvider: CacheProviderPort,
    private readonly auditLogger: SecurityAuditLoggerPort = new InMemorySecurityAuditLogger()
  ) {}

  public async execute(cmd: VerifyPasskeyRegistrationCommand): Promise<PasskeySummaryDTO> {
    const tenantId = TenantId.create(cmd.tenantId);
    const persistedPolicy = await this.policyRepository.findByTenantId(tenantId);
    const policy = persistedPolicy ?? TenantPolicy.defaultFor(tenantId);

    if (!policy.getAllowedAuthMethods().passkeys) {
      throw new OAuth2AuthenticationError(
        'auth_method_disabled_for_tenant',
        `Passkeys are disabled for tenant "${tenantId.getValue()}"`,
        403
      );
    }

    const cacheKey = challengeCacheKey(tenantId.getValue(), cmd.userId);
    const stored = await this.cacheProvider.get<StoredRegistrationChallenge>(cacheKey);
    // Single-use: eliminar inmediatamente el reto antes de verificar
    await this.cacheProvider.delete(cacheKey);

    if (!stored) {
      await this.auditLogger.logEvent({
        eventType: 'PASSKEY_REGISTRATION_REJECTED',
        severity: 'WARN',
        status: 'FAILURE',
        tenantId: tenantId.getValue(),
        actor: { userId: cmd.userId, type: 'USER', ip: cmd.ip },
        timestamp: new Date(),
        reason: 'missing_or_expired_challenge',
      });
      throw new OAuth2AuthenticationError(
        'invalid_webauthn_challenge',
        'WebAuthn registration challenge is missing, expired, or already consumed',
        400
      );
    }

    let verification;
    try {
      verification = await this.verifier.verifyRegistrationResponse({
        response: cmd.response,
        expectedChallenge: stored.challenge,
        expectedOrigin: stored.expectedOrigins,
        expectedRPID: stored.rpID,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'verification_error';
      await this.auditLogger.logEvent({
        eventType: 'PASSKEY_REGISTRATION_REJECTED',
        severity: 'WARN',
        status: 'FAILURE',
        tenantId: tenantId.getValue(),
        actor: { userId: cmd.userId, type: 'USER', ip: cmd.ip },
        timestamp: new Date(),
        reason,
      });
      throw new OAuth2AuthenticationError('invalid_webauthn_response', reason, 400);
    }

    if (!verification.verified || !verification.credentialId || !verification.publicKeyCose) {
      await this.auditLogger.logEvent({
        eventType: 'PASSKEY_REGISTRATION_REJECTED',
        severity: 'WARN',
        status: 'FAILURE',
        tenantId: tenantId.getValue(),
        actor: { userId: cmd.userId, type: 'USER', ip: cmd.ip },
        timestamp: new Date(),
        reason: 'attestation_verification_failed',
      });
      throw new OAuth2AuthenticationError(
        'invalid_webauthn_response',
        'WebAuthn registration response could not be verified',
        400
      );
    }

    const credential = WebAuthnCredential.create({
      id: randomUUID(),
      userId: cmd.userId,
      tenantId,
      credentialId: verification.credentialId,
      publicKeyCose: verification.publicKeyCose,
      counter: verification.counter ?? 0,
      transports: verification.transports ?? [],
      deviceType: verification.deviceType ?? 'singleDevice',
      backedUp: verification.backedUp ?? false,
    });

    await this.credentialRepository.save(credential);

    await this.auditLogger.logEvent({
      eventType: 'PASSKEY_REGISTERED',
      severity: 'INFO',
      status: 'SUCCESS',
      tenantId: tenantId.getValue(),
      actor: { userId: cmd.userId, type: 'USER', ip: cmd.ip },
      timestamp: new Date(),
      details: {
        credentialId: credential.getCredentialId(),
        deviceType: credential.getDeviceType(),
        backedUp: credential.isBackedUp(),
      },
    });

    return toPasskeySummaryDTO(credential);
  }
}

export class ListPasskeysQueryHandler {
  constructor(private readonly credentialRepository: WebAuthnCredentialRepositoryPort) {}

  public async execute(userId: string, tenantIdRaw: string): Promise<PasskeySummaryDTO[]> {
    const tenantId = TenantId.create(tenantIdRaw);
    const items = await this.credentialRepository.findByUserAndTenant(userId, tenantId);
    return items.map(toPasskeySummaryDTO);
  }
}

export class RevokePasskeyCommandHandler {
  constructor(
    private readonly credentialRepository: WebAuthnCredentialRepositoryPort,
    private readonly auditLogger: SecurityAuditLoggerPort = new InMemorySecurityAuditLogger()
  ) {}

  public async execute(id: string, userId: string, tenantIdRaw: string): Promise<void> {
    const tenantId = TenantId.create(tenantIdRaw);
    const deleted = await this.credentialRepository.deleteByIdAndUser(id, userId, tenantId);
    if (!deleted) {
      const notFound = new DomainValidationError(`Passkey "${id}" not found`);
      (notFound as Error & { statusCode?: number }).statusCode = 404;
      throw notFound;
    }

    await this.auditLogger.logEvent({
      eventType: 'PASSKEY_REVOKED',
      severity: 'INFO',
      status: 'SUCCESS',
      tenantId: tenantId.getValue(),
      actor: { userId, type: 'USER' },
      timestamp: new Date(),
      details: { passkeyRecordId: id },
    });
  }
}
