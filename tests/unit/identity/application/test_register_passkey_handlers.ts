import { TenantPolicy } from '../../../../src/contexts/identity/domain/entities/tenant_policy/entity';
import { TenantId } from '../../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { OAuth2AuthenticationError } from '../../../../src/contexts/identity/domain/exceptions/oauth2/error';
import { InMemoryWebAuthnCredentialRepository } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/webauthn/in_memory_webauthn_credential_repository';
import { InMemoryTenantPolicyRepository } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/tenant_policy/in_memory_tenant_policy_repository';
import { MemoryCacheAdapter } from '../../../../src/contexts/identity/infrastructure/cache/memory_cache_adapter';
import { WebAuthnVerifierPort } from '../../../../src/contexts/identity/application/ports/security/webauthn_verifier_port';
import { SecurityAuditEvent, SecurityAuditLoggerPort } from '../../../../src/contexts/identity/application/ports/security/audit_logger';
import {
  BeginPasskeyRegistrationCommandHandler,
  VerifyPasskeyRegistrationCommandHandler,
} from '../../../../src/contexts/identity/application/commands/register_passkey/handler';

describe('Unit: US-35 Passkey Registration Handlers', () => {
  const createDeps = () => {
    const credRepo = new InMemoryWebAuthnCredentialRepository();
    const policyRepo = new InMemoryTenantPolicyRepository();
    const cache = new MemoryCacheAdapter();
    const events: SecurityAuditEvent[] = [];
    const auditLogger: SecurityAuditLoggerPort = {
      logEvent: async (e) => {
        events.push(e);
      },
    };
    const verifier: WebAuthnVerifierPort = {
      generateRegistrationOptions: async (input) => ({
        challenge: 'challenge-base64url-01',
        rp: { name: input.rpName, id: input.rpID },
        user: { id: 'dXNy', name: input.userName, displayName: input.userName },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
        excludeCredentials: input.excludeCredentialIds.map((id) => ({ id, type: 'public-key' })),
      }),
      verifyRegistrationResponse: async ({ expectedChallenge }) => {
        if (expectedChallenge !== 'challenge-base64url-01') {
          return { verified: false };
        }
        return {
          verified: true,
          credentialId: 'cred-webauthn-01',
          publicKeyCose: Buffer.from([0x01, 0x02, 0x03, 0x04]),
          counter: 0,
          transports: ['internal'],
          deviceType: 'multiDevice',
          backedUp: true,
        };
      },
    };

    return { credRepo, policyRepo, cache, verifier, auditLogger, events };
  };

  it('should reject passkey registration with 403 when TenantPolicy.allowedAuthMethods.passkeys is false', async () => {
    const { credRepo, policyRepo, cache, verifier } = createDeps();
    const begin = new BeginPasskeyRegistrationCommandHandler(credRepo, policyRepo, verifier, cache);

    await expect(
      begin.execute({
        userId: 'usr-1',
        email: 'user@acme.com',
        tenantId: 'acme-corp',
      })
    ).rejects.toThrow(OAuth2AuthenticationError);
  });

  it('should generate single-use challenge, verify registration, persist COSE key and reject replay', async () => {
    const { credRepo, policyRepo, cache, verifier, auditLogger, events } = createDeps();
    await policyRepo.save(
      TenantPolicy.create({
        tenantId: TenantId.create('acme-corp'),
        requiredAttributes: { phone: false },
        kycPolicy: { required: false, minLevel: 'basic' },
        allowedAuthMethods: { password: true, passkeys: true, federatedOidc: true },
        updatedBy: 'admin',
      })
    );

    const begin = new BeginPasskeyRegistrationCommandHandler(credRepo, policyRepo, verifier, cache);
    const verify = new VerifyPasskeyRegistrationCommandHandler(
      credRepo,
      policyRepo,
      verifier,
      cache,
      auditLogger
    );

    const options = await begin.execute({
      userId: 'usr-1',
      email: 'user@acme.com',
      tenantId: 'acme-corp',
    });
    expect(options.challenge).toBe('challenge-base64url-01');

    const saved = await verify.execute({
      userId: 'usr-1',
      tenantId: 'acme-corp',
      response: { id: 'cred-webauthn-01' },
    });

    expect(saved.credentialId).toBe('cred-webauthn-01');
    expect(saved.deviceType).toBe('multiDevice');
    expect((saved as unknown as Record<string, unknown>).publicKeyCose).toBeUndefined();
    expect(events.some((e) => e.eventType === 'PASSKEY_REGISTERED')).toBe(true);

    // Replay with consumed challenge must fail with 400 invalid_webauthn_challenge
    await expect(
      verify.execute({
        userId: 'usr-1',
        tenantId: 'acme-corp',
        response: { id: 'cred-webauthn-01' },
      })
    ).rejects.toThrow(OAuth2AuthenticationError);
    expect(events.some((e) => e.eventType === 'PASSKEY_REGISTRATION_REJECTED')).toBe(true);
  });
});
