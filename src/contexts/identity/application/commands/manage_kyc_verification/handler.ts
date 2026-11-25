import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import {
  KycLevel,
  KycStatus,
  UserKycVerification,
} from '../../../domain/entities/kyc_verification/entity';
import { UserKycVerificationRepositoryPort } from '../../../domain/ports/user_kyc_verification_repository_port';
import { TenantPolicy } from '../../../domain/entities/tenant_policy/entity';
import { TenantPolicyRepositoryPort } from '../../../domain/ports/tenant_policy_repository_port';
import { TenantId } from '../../../domain/value_objects/tenant_id/value';
import { OAuth2AuthenticationError } from '../../../domain/exceptions/oauth2/error';
import { DomainValidationError } from '../../../domain/exceptions/user/error';
import { KycVerificationPort } from '../../ports/kyc/kyc_verification_port';
import { SecurityAuditLoggerPort } from '../../ports/security/audit_logger';
import { InMemorySecurityAuditLogger } from '../../../infrastructure/logging/memory_security_audit_logger';

export interface KycStatusDTO {
  readonly userId: string;
  readonly tenantId: string;
  readonly status: KycStatus;
  readonly level: KycLevel;
  readonly kycVerified: boolean;
  readonly providerRef: string | null;
  readonly verifiedAt: string | null;
  readonly expiresAt: string | null;
}

export function toKycStatusDTO(v: UserKycVerification, now: Date = new Date()): KycStatusDTO {
  const claims = v.toJwtClaims(now);
  return {
    userId: v.getUserId(),
    tenantId: v.getTenantId().getValue(),
    status: claims.kyc_status,
    level: v.getLevel(),
    kycVerified: claims.kyc_verified,
    providerRef: v.getProviderRef(),
    verifiedAt: v.getVerifiedAt()?.toISOString() ?? null,
    expiresAt: v.getExpiresAt()?.toISOString() ?? null,
  };
}

/**
 * Helper de aplicación para proyectar claims KYC (kyc_verified, kyc_status) en JWT RFC 9068.
 */
export class KycClaimsResolver {
  constructor(
    private readonly kycRepository: UserKycVerificationRepositoryPort,
    private readonly policyRepository?: TenantPolicyRepositoryPort
  ) {}

  public async resolveClaims(
    userId: string,
    tenantIdRaw: string,
    now: Date = new Date()
  ): Promise<{ readonly kyc_verified: boolean; readonly kyc_status: KycStatus } | null> {
    const tenantId = TenantId.create(tenantIdRaw);
    const verification = await this.kycRepository.findByUserAndTenant(userId, tenantId);
    if (verification) {
      return verification.toJwtClaims(now);
    }

    if (this.policyRepository) {
      const persisted = await this.policyRepository.findByTenantId(tenantId);
      const policy = persisted ?? TenantPolicy.defaultFor(tenantId);
      if (policy.getKycPolicy().required) {
        return { kyc_verified: false, kyc_status: 'UNVERIFIED' };
      }
    }

    return null;
  }
}

export interface StartKycSessionCommand {
  readonly userId: string;
  readonly tenantId: string;
  readonly level?: KycLevel;
  readonly ip?: string;
}

export interface StartKycSessionResponseDTO extends KycStatusDTO {
  readonly sessionUrl: string;
  readonly mode: 'deterministic_dev' | 'external_provider';
}

export class StartKycVerificationCommandHandler {
  constructor(
    private readonly kycRepository: UserKycVerificationRepositoryPort,
    private readonly kycPort: KycVerificationPort,
    private readonly policyRepository?: TenantPolicyRepositoryPort,
    private readonly auditLogger: SecurityAuditLoggerPort = new InMemorySecurityAuditLogger()
  ) {}

  public async execute(cmd: StartKycSessionCommand): Promise<StartKycSessionResponseDTO> {
    const tenantId = TenantId.create(cmd.tenantId);
    let level: KycLevel = cmd.level ?? 'basic';

    if (!cmd.level && this.policyRepository) {
      const persisted = await this.policyRepository.findByTenantId(tenantId);
      const policy = persisted ?? TenantPolicy.defaultFor(tenantId);
      level = policy.getKycPolicy().minLevel;
    }

    const session = await this.kycPort.startVerificationSession({
      userId: cmd.userId,
      tenantId: tenantId.getValue(),
      level,
    });

    const existing = await this.kycRepository.findByUserAndTenant(cmd.userId, tenantId);
    const verification =
      existing ??
      UserKycVerification.create({
        id: randomUUID(),
        userId: cmd.userId,
        tenantId,
        level,
      });

    verification.startSession(level, session.providerRef);
    await this.kycRepository.save(verification);

    await this.auditLogger.logEvent({
      eventType: 'KYC_SESSION_STARTED',
      severity: 'INFO',
      status: 'SUCCESS',
      tenantId: tenantId.getValue(),
      actor: { userId: cmd.userId, type: 'USER', ip: cmd.ip },
      timestamp: new Date(),
      details: {
        providerRef: session.providerRef,
        level,
        mode: session.mode,
      },
    });

    return {
      ...toKycStatusDTO(verification),
      sessionUrl: session.sessionUrl,
      mode: session.mode,
    };
  }
}

export interface ProcessKycWebhookCommand {
  readonly tenantId: string;
  readonly providerRef: string;
  readonly verdict: 'VERIFIED' | 'REJECTED';
  readonly expiresAt?: string | null;
  readonly rawBody: string;
  readonly signatureHeader?: string;
  readonly ip?: string;
}

export class ProcessKycWebhookCommandHandler {
  constructor(
    private readonly kycRepository: UserKycVerificationRepositoryPort,
    private readonly webhookSecret: string | undefined,
    private readonly auditLogger: SecurityAuditLoggerPort = new InMemorySecurityAuditLogger()
  ) {}

  private verifyHmacSignature(rawBody: string, signatureHeader?: string): boolean {
    if (!this.webhookSecret || !this.webhookSecret.trim()) {
      return false;
    }
    if (!signatureHeader || !signatureHeader.trim()) {
      return false;
    }

    const receivedHex = signatureHeader.trim().replace(/^sha256=/i, '').toLowerCase();
    if (!/^[0-9a-f]+$/i.test(receivedHex) || receivedHex.length !== 64) {
      return false;
    }

    const expectedHex = createHmac('sha256', this.webhookSecret)
      .update(rawBody, 'utf8')
      .digest('hex');

    const a = Buffer.from(receivedHex, 'hex');
    const b = Buffer.from(expectedHex, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  public async execute(cmd: ProcessKycWebhookCommand): Promise<KycStatusDTO> {
    const tenantId = TenantId.create(cmd.tenantId);

    if (!this.verifyHmacSignature(cmd.rawBody, cmd.signatureHeader)) {
      await this.auditLogger.logEvent({
        eventType: 'KYC_WEBHOOK_SIGNATURE_INVALID',
        severity: 'ALERT',
        status: 'DENIED',
        tenantId: tenantId.getValue(),
        ip: cmd.ip,
        timestamp: new Date(),
        reason: this.webhookSecret ? 'hmac_mismatch' : 'webhook_secret_not_configured',
        details: { providerRef: cmd.providerRef },
      });
      throw new OAuth2AuthenticationError(
        'invalid_signature',
        'Invalid or missing KYC webhook HMAC signature',
        401
      );
    }

    const verification = await this.kycRepository.findByProviderRef(cmd.providerRef, tenantId);
    if (!verification) {
      const notFound = new DomainValidationError(
        `KYC verification with providerRef "${cmd.providerRef}" not found`
      );
      (notFound as Error & { statusCode?: number }).statusCode = 404;
      throw notFound;
    }

    if (cmd.verdict === 'VERIFIED') {
      const expiresAt = cmd.expiresAt ? new Date(cmd.expiresAt) : null;
      verification.markVerified(expiresAt);
    } else if (cmd.verdict === 'REJECTED') {
      verification.markRejected();
    } else {
      throw new DomainValidationError(`Unsupported KYC verdict "${String(cmd.verdict)}"`);
    }

    await this.kycRepository.save(verification);

    await this.auditLogger.logEvent({
      eventType: 'KYC_VERIFICATION_UPDATED',
      severity: 'INFO',
      status: 'SUCCESS',
      tenantId: tenantId.getValue(),
      actor: { userId: verification.getUserId(), type: 'SYSTEM', ip: cmd.ip },
      timestamp: new Date(),
      details: {
        providerRef: cmd.providerRef,
        status: verification.getStatus(),
        level: verification.getLevel(),
      },
    });

    return toKycStatusDTO(verification);
  }
}

export class GetKycStatusQueryHandler {
  constructor(
    private readonly kycRepository: UserKycVerificationRepositoryPort,
    private readonly policyRepository?: TenantPolicyRepositoryPort
  ) {}

  public async execute(userId: string, tenantIdRaw: string): Promise<KycStatusDTO> {
    const tenantId = TenantId.create(tenantIdRaw);
    const existing = await this.kycRepository.findByUserAndTenant(userId, tenantId);
    if (existing) {
      return toKycStatusDTO(existing);
    }

    let level: KycLevel = 'basic';
    if (this.policyRepository) {
      const persisted = await this.policyRepository.findByTenantId(tenantId);
      const policy = persisted ?? TenantPolicy.defaultFor(tenantId);
      level = policy.getKycPolicy().minLevel;
    }

    return {
      userId,
      tenantId: tenantId.getValue(),
      status: 'UNVERIFIED',
      level,
      kycVerified: false,
      providerRef: null,
      verifiedAt: null,
      expiresAt: null,
    };
  }
}
