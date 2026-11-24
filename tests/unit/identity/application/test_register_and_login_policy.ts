import { User } from '../../../../src/contexts/identity/domain/entities/user/aggregate';
import { Email } from '../../../../src/contexts/identity/domain/value_objects/email/value';
import { TenantId } from '../../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { TenantPolicy } from '../../../../src/contexts/identity/domain/entities/tenant_policy/entity';
import { DomainValidationError } from '../../../../src/contexts/identity/domain/exceptions/user/error';
import { OAuth2AuthenticationError } from '../../../../src/contexts/identity/domain/exceptions/oauth2/error';
import { UserRepositoryPort } from '../../../../src/contexts/identity/application/ports/user/repository';
import { HashProviderPort } from '../../../../src/contexts/identity/application/ports/security/hash_provider';
import { TokenProviderPort } from '../../../../src/contexts/identity/application/ports/security/token_provider';
import { InMemoryTenantPolicyRepository } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/tenant_policy/in_memory_tenant_policy_repository';
import { RegisterUserCommandHandler } from '../../../../src/contexts/identity/application/commands/register_user/handler';
import { LoginUserCommandHandler } from '../../../../src/contexts/identity/application/commands/login_user/handler';

class InMemoryUserRepo implements UserRepositoryPort {
  private readonly users = new Map<string, User>();

  public async save(user: User): Promise<void> {
    this.users.set(`${user.getTenantId().getValue()}:${user.getId()}`, user);
  }

  public async findByEmail(email: Email, tenantId: TenantId): Promise<User | null> {
    for (const user of this.users.values()) {
      if (
        user.getTenantId().getValue() === tenantId.getValue() &&
        user.getEmail().getValue() === email.getValue()
      ) {
        return user;
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

describe('Unit: US-32 RegisterUser & LoginUser with TenantPolicy', () => {
  const hashProvider: HashProviderPort = {
    hash: async (plain) => `hashed:${plain}`,
    compare: async (plain, hashed) => hashed === `hashed:${plain}`,
  };
  const tokenProvider: TokenProviderPort = {
    generateToken: async (payload) => `jwt:${payload.tenantId}:${payload.userId}`,
    verifyToken: async () => {
      throw new Error('not needed');
    },
  };

  it('should require E.164 phone when TenantPolicy.requiredAttributes.phone is true', async () => {
    const userRepo = new InMemoryUserRepo();
    const policyRepo = new InMemoryTenantPolicyRepository();
    await policyRepo.save(
      TenantPolicy.create({
        tenantId: TenantId.create('tusherramientas-a'),
        requiredAttributes: { phone: true },
        kycPolicy: { required: true, minLevel: 'biometric_liveness' },
        allowedAuthMethods: { password: true, passkeys: false, federatedOidc: true },
        updatedBy: 'admin',
      })
    );

    const registerHandler = new RegisterUserCommandHandler(
      userRepo,
      hashProvider,
      tokenProvider,
      policyRepo
    );

    await expect(
      registerHandler.execute({
        tenantId: 'tusherramientas-a',
        email: 'ana@tusherramientas.com',
        password: 'Password123!',
      })
    ).rejects.toThrow(DomainValidationError);

    const created = await registerHandler.execute({
      tenantId: 'tusherramientas-a',
      email: 'ana@tusherramientas.com',
      password: 'Password123!',
      phone: '+54 911 1234-5678',
    });

    expect(created.phone).toBe('+5491112345678');

    const loginHandler = new LoginUserCommandHandler(
      userRepo,
      hashProvider,
      tokenProvider,
      policyRepo
    );
    const loggedIn = await loginHandler.execute({
      tenantId: 'tusherramientas-a',
      email: 'ana@tusherramientas.com',
      password: 'Password123!',
    });
    expect(loggedIn.phone).toBe('+5491112345678');
  });

  it('should reject register and login with 403 auth_method_disabled_for_tenant when password is disabled', async () => {
    const userRepo = new InMemoryUserRepo();
    const policyRepo = new InMemoryTenantPolicyRepository();
    await policyRepo.save(
      TenantPolicy.create({
        tenantId: TenantId.create('sso-only-corp'),
        requiredAttributes: { phone: false },
        kycPolicy: { required: false, minLevel: 'basic' },
        allowedAuthMethods: { password: false, passkeys: false, federatedOidc: true },
        updatedBy: 'admin',
      })
    );

    const registerHandler = new RegisterUserCommandHandler(
      userRepo,
      hashProvider,
      tokenProvider,
      policyRepo
    );
    const loginHandler = new LoginUserCommandHandler(
      userRepo,
      hashProvider,
      tokenProvider,
      policyRepo
    );

    await expect(
      registerHandler.execute({
        tenantId: 'sso-only-corp',
        email: 'user@sso-only.com',
        password: 'Password123!',
      })
    ).rejects.toThrow(OAuth2AuthenticationError);

    await expect(
      loginHandler.execute({
        tenantId: 'sso-only-corp',
        email: 'user@sso-only.com',
        password: 'Password123!',
      })
    ).rejects.toThrow(OAuth2AuthenticationError);
  });
});
