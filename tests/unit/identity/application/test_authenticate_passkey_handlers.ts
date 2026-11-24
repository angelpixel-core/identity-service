import { User } from '../../../../src/contexts/identity/domain/entities/user/aggregate';
import { WebAuthnCredential } from '../../../../src/contexts/identity/domain/entities/webauthn_credential/entity';
import { TenantPolicy } from '../../../../src/contexts/identity/domain/entities/tenant_policy/entity';
import { Email } from '../../../../src/contexts/identity/domain/value_objects/email/value';
import { TenantId } from '../../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { OAuth2AuthenticationError } from '../../../../src/contexts/identity/domain/exceptions/oauth2/error';
import { UserRepositoryPort } from '../../../../src/contexts/identity/application/ports/user/repository';
import { InMemoryWebAuthnCredentialRepository } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/webauthn/in_memory_webauthn_credential_repository';
import { InMemoryTenantPolicyRepository } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/tenant_policy/in_memory_tenant_policy_repository';
import { InMemoryRefreshSessionRepository } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/refresh_session/in_memory_repository';
import { MemoryCacheAdapter } from '../../../../src/contexts/identity/infrastructure/cache/memory_cache_adapter';
import { JwtTokenAdapter } from '../../../../src/contexts/identity/infrastructure/security/jwt_adapter';
import { WebAuthnVerifierPort } from '../../../../src/contexts/identity/application/ports/security/webauthn_verifier_port';
import {
  SecurityAuditEvent,
  SecurityAuditLoggerPort,
} from '../../../../src/contexts/identity/application/ports/security/audit_logger';
import {
  BeginPasskeyAuthenticationCommandHandler,
  VerifyPasskeyAuthenticationCommandHandler,
} from '../../../../src/contexts/identity/application/commands/authenticate_passkey/handler';

class InMemoryUserRepo implements UserRepositoryPort {
  private readonly users = new Map<string, User>();
  public async save(user: User): Promise<void> {
    this.users.set(`${user.getTenantId().getValue()}:${user.getId()}`, user);
  }
  public async findByEmail(email: Email, tenantId: TenantId): Promise<User | null> {
    for (const u of this.users.values()) {
      if (u.getTenantId().getValue() === tenantId.getValue() && u.getEmail().getValue() === email.getValue()) {
        return u;
      }
    }
    return null;
  }
  public async findById(id: string, tenantId: TenantId): Promise<User | null> {
    return this.users.get(`${tenantId.getValue()}:${id}`) ?? null;
  }
  public async delete(id: string, tenantId: TenantId): Promise<boolean> {
    return this.users.delete(`${tenantId.getValue()}:${id}`);
  }
}

describe('Unit: US-36 Passkey Authentication & RFC 9068 amr Claims', () => {
  const setup = async (opts?: {
    deviceType?: 'singleDevice' | 'multiDevice';
    storedCounter?: number;
    returnedCounter?: number;
    passkeysEnabled?: boolean;
  }) => {
    const userRepo = new InMemoryUserRepo();
    const credRepo = new InMemoryWebAuthnCredentialRepository();
    const policyRepo = new InMemoryTenantPolicyRepository();
    const refreshRepo = new InMemoryRefreshSessionRepository();
    const cache = new MemoryCacheAdapter();
    const tokenProvider = new JwtTokenAdapter('unit_secret_passkey_auth_32_chars!');
    const events: SecurityAuditEvent[] = [];
    const auditLogger: SecurityAuditLoggerPort = {
      logEvent: async (e) => {
        events.push(e);
      },
    };

    const tenantId = TenantId.create('acme-corp');
    await policyRepo.save(
      TenantPolicy.create({
        tenantId,
        requiredAttributes: { phone: false },
        kycPolicy: { required: false, minLevel: 'basic' },
        allowedAuthMethods: {
          password: true,
          passkeys: opts?.passkeysEnabled ?? true,
          federatedOidc: true,
        },
        updatedBy: 'admin',
      })
    );

    const user = User.create({
      id: '11111111-1111-4111-8111-111111111111',
      email: Email.create('alice@acme-corp.com'),
      tenantId,
      passwordHash: '$2b$10$hashed',
      roles: ['member'],
    });
    await userRepo.save(user);

    await credRepo.save(
      WebAuthnCredential.create({
        id: '22222222-2222-4222-8222-222222222222',
        userId: user.getId(),
        tenantId,
        credentialId: 'cred-auth-01',
        publicKeyCose: Buffer.from([1, 2, 3, 4]),
        counter: opts?.storedCounter ?? 0,
        deviceType: opts?.deviceType ?? 'multiDevice',
        backedUp: (opts?.deviceType ?? 'multiDevice') === 'multiDevice',
      })
    );

    const verifier: WebAuthnVerifierPort = {
      generateRegistrationOptions: async () => ({ challenge: 'reg' }),
      verifyRegistrationResponse: async () => ({ verified: false }),
      generateAuthenticationOptions: async (input) => ({
        challenge: 'auth-challenge-01',
        rpId: input.rpID,
        allowCredentials: input.allowCredentialIds.map((id) => ({ id, type: 'public-key' })),
      }),
      verifyAuthenticationResponse: async () => ({
        verified: true,
        newCounter: opts?.returnedCounter ?? 0,
      }),
    };

    const begin = new BeginPasskeyAuthenticationCommandHandler(
      credRepo,
      userRepo,
      policyRepo,
      verifier,
      cache
    );
    const verify = new VerifyPasskeyAuthenticationCommandHandler(
      credRepo,
      userRepo,
      policyRepo,
      verifier,
      cache,
      tokenProvider,
      refreshRepo,
      auditLogger
    );

    return { begin, verify, tokenProvider, credRepo, events };
  };

  it('should authenticate multiDevice passkey with counter=0 and emit JWT with amr: ["hwk", "user"]', async () => {
    const { begin, verify, tokenProvider, events } = await setup({
      deviceType: 'multiDevice',
      storedCounter: 0,
      returnedCounter: 0,
    });

    const opts = await begin.execute({ tenantId: 'acme-corp' });
    expect(opts.challenge).toBe('auth-challenge-01');

    const result = await verify.execute({
      tenantId: 'acme-corp',
      challenge: opts.challenge,
      response: { id: 'cred-auth-01' },
    });

    expect(result.amr).toEqual(['hwk', 'user']);
    expect(result.refreshToken).toBeTruthy();

    const decoded = await tokenProvider.verifyToken(result.accessToken);
    expect(decoded.claims?.amr).toEqual(['hwk', 'user']);
    expect(events.some((e) => e.eventType === 'PASSKEY_AUTH_SUCCESS')).toBe(true);
  });

  it('should detect signCount regression on singleDevice passkey as PASSKEY_CLONE_DETECTED (401)', async () => {
    const { begin, verify, events } = await setup({
      deviceType: 'singleDevice',
      storedCounter: 5,
      returnedCounter: 5,
    });

    const opts = await begin.execute({ tenantId: 'acme-corp', email: 'alice@acme-corp.com' });

    await expect(
      verify.execute({
        tenantId: 'acme-corp',
        challenge: opts.challenge,
        response: { id: 'cred-auth-01' },
      })
    ).rejects.toThrow(OAuth2AuthenticationError);

    expect(events.some((e) => e.eventType === 'PASSKEY_CLONE_DETECTED')).toBe(true);
  });

  it('should reject passkey authentication with 403 when passkeys are disabled in TenantPolicy', async () => {
    const { begin } = await setup({ passkeysEnabled: false });

    await expect(begin.execute({ tenantId: 'acme-corp' })).rejects.toThrow(
      OAuth2AuthenticationError
    );
  });
});
