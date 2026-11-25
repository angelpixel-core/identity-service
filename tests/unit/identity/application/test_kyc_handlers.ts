import { createHmac } from 'crypto';
import { TenantId } from '../../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { TenantPolicy } from '../../../../src/contexts/identity/domain/entities/tenant_policy/entity';
import { OAuth2AuthenticationError } from '../../../../src/contexts/identity/domain/exceptions/oauth2/error';
import { InMemoryUserKycVerificationRepository } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/kyc/in_memory_user_kyc_verification_repository';
import { InMemoryTenantPolicyRepository } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/tenant_policy/in_memory_tenant_policy_repository';
import { DeterministicKycAdapter } from '../../../../src/contexts/identity/infrastructure/kyc/deterministic_kyc_adapter';
import {
  SecurityAuditEvent,
  SecurityAuditLoggerPort,
} from '../../../../src/contexts/identity/application/ports/security/audit_logger';
import {
  KycClaimsResolver,
  ProcessKycWebhookCommandHandler,
  StartKycVerificationCommandHandler,
} from '../../../../src/contexts/identity/application/commands/manage_kyc_verification/handler';

describe('Unit: US-37 KYC Verification Handlers & HMAC Fail-Closed', () => {
  const secret = 'unit_kyc_webhook_secret_32_chars!';

  it('should start session, reject invalid/missing HMAC fail-closed, accept valid HMAC and resolve JWT claims', async () => {
    const kycRepo = new InMemoryUserKycVerificationRepository();
    const policyRepo = new InMemoryTenantPolicyRepository();
    const kycPort = new DeterministicKycAdapter();
    const events: SecurityAuditEvent[] = [];
    const auditLogger: SecurityAuditLoggerPort = {
      logEvent: async (e) => {
        events.push(e);
      },
    };

    await policyRepo.save(
      TenantPolicy.create({
        tenantId: TenantId.create('tusherramientas-a'),
        requiredAttributes: { phone: true },
        kycPolicy: { required: true, minLevel: 'biometric_liveness' },
        allowedAuthMethods: { password: true, passkeys: false, federatedOidc: true },
        updatedBy: 'admin',
      })
    );

    const claimsResolver = new KycClaimsResolver(kycRepo, policyRepo);
    expect(await claimsResolver.resolveClaims('usr-1', 'tusherramientas-a')).toEqual({
      kyc_verified: false,
      kyc_status: 'UNVERIFIED',
    });

    const startHandler = new StartKycVerificationCommandHandler(
      kycRepo,
      kycPort,
      policyRepo,
      auditLogger
    );
    const session = await startHandler.execute({
      userId: 'usr-1',
      tenantId: 'tusherramientas-a',
    });
    expect(session.status).toBe('PENDING');
    expect(session.level).toBe('biometric_liveness');
    expect(events.some((e) => e.eventType === 'KYC_SESSION_STARTED')).toBe(true);

    // Fail-closed when webhookSecret is undefined
    const unconfiguredWebhook = new ProcessKycWebhookCommandHandler(
      kycRepo,
      undefined,
      auditLogger
    );
    await expect(
      unconfiguredWebhook.execute({
        tenantId: 'tusherramientas-a',
        providerRef: session.providerRef!,
        verdict: 'VERIFIED',
        rawBody: '{}',
        signatureHeader: 'sha256=' + '0'.repeat(64),
      })
    ).rejects.toThrow(OAuth2AuthenticationError);

    const webhookHandler = new ProcessKycWebhookCommandHandler(kycRepo, secret, auditLogger);
    const body = JSON.stringify({
      tenantId: 'tusherramientas-a',
      providerRef: session.providerRef,
      verdict: 'VERIFIED',
    });

    // Invalid signature -> 401 + KYC_WEBHOOK_SIGNATURE_INVALID
    await expect(
      webhookHandler.execute({
        tenantId: 'tusherramientas-a',
        providerRef: session.providerRef!,
        verdict: 'VERIFIED',
        rawBody: body,
        signatureHeader: 'sha256=' + 'a'.repeat(64),
      })
    ).rejects.toThrow(OAuth2AuthenticationError);
    expect(events.some((e) => e.eventType === 'KYC_WEBHOOK_SIGNATURE_INVALID')).toBe(true);

    // Valid signature -> VERIFIED
    const sig = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    const updated = await webhookHandler.execute({
      tenantId: 'tusherramientas-a',
      providerRef: session.providerRef!,
      verdict: 'VERIFIED',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      rawBody: body,
      signatureHeader: `sha256=${sig}`,
    });

    expect(updated.status).toBe('VERIFIED');
    expect(updated.kycVerified).toBe(true);
    expect(events.some((e) => e.eventType === 'KYC_VERIFICATION_UPDATED')).toBe(true);
    expect(await claimsResolver.resolveClaims('usr-1', 'tusherramientas-a')).toEqual({
      kyc_verified: true,
      kyc_status: 'VERIFIED',
    });
  });
});
