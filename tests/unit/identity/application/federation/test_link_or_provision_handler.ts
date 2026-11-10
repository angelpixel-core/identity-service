import { LinkOrProvisionFederatedUserCommandHandler } from '../../../../../src/contexts/identity/application/commands/link_or_provision_federated_user/handler';
import { UserRepositoryPort } from '../../../../../src/contexts/identity/application/ports/user/repository';
import { TokenProviderPort } from '../../../../../src/contexts/identity/application/ports/security/token_provider';
import { InMemoryFederatedIdentityRepository } from '../../../../../src/contexts/identity/infrastructure/persistence/repositories/federated_identity/in_memory_federated_identity_repository';
import { InMemoryRefreshSessionRepository } from '../../../../../src/contexts/identity/infrastructure/persistence/repositories/refresh_session/in_memory_repository';
import { InMemorySecurityAuditLogger } from '../../../../../src/contexts/identity/infrastructure/logging/memory_security_audit_logger';
import { User } from '../../../../../src/contexts/identity/domain/entities/user/aggregate';
import { FederatedIdentity } from '../../../../../src/contexts/identity/domain/entities/federated_identity/aggregate';
import { Email } from '../../../../../src/contexts/identity/domain/value_objects/email/value';
import { TenantId } from '../../../../../src/contexts/identity/domain/value_objects/tenant_id/value';

describe('Application Command Handler: LinkOrProvisionFederatedUserCommandHandler (US-11 Unit)', () => {
  let userRepository: jest.Mocked<UserRepositoryPort>;
  let federatedIdentityRepo: InMemoryFederatedIdentityRepository;
  let refreshSessionRepo: InMemoryRefreshSessionRepository;
  let tokenProvider: jest.Mocked<TokenProviderPort>;
  let auditLogger: InMemorySecurityAuditLogger;
  let handler: LinkOrProvisionFederatedUserCommandHandler;

  const tenantId = 'alpha-corp';
  const emailStr = 'charlie@federated-corp.com';
  const subjectId = 'g-sub-999000111';

  beforeEach(() => {
    userRepository = {
      save: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue(null),
      findByEmail: jest.fn().mockResolvedValue(null),
    };

    federatedIdentityRepo = new InMemoryFederatedIdentityRepository();
    refreshSessionRepo = new InMemoryRefreshSessionRepository();
    auditLogger = new InMemorySecurityAuditLogger();

    tokenProvider = {
      generateToken: jest.fn().mockResolvedValue('jwt-mock-rs256-access-token'),
      verifyToken: jest.fn(),
    };

    handler = new LinkOrProvisionFederatedUserCommandHandler(
      userRepository,
      federatedIdentityRepo,
      tokenProvider,
      refreshSessionRepo,
      auditLogger
    );
  });

  describe('Just-In-Time (JIT) Provisioning', () => {
    it('should provision a new User, link federated identity and issue native session tokens', async () => {
      const result = await handler.execute({
        tenantId,
        userProfile: {
          provider: 'google',
          externalSubjectId: subjectId,
          email: emailStr,
          emailVerified: true,
          name: 'Charlie External',
        },
        clientId: 'spa-web-client',
        ip: '192.168.1.10',
      });

      expect(result.isNewUser).toBe(true);
      expect(result.linked).toBe(true);
      expect(result.provider).toBe('google');
      expect(result.accessToken).toBe('jwt-mock-rs256-access-token');
      expect(result.refreshToken).toBeDefined();
      expect(result.user.email).toBe(emailStr);
      expect(result.user.tenantId).toBe(tenantId);

      // Verify User aggregate was created with federated password hash
      expect(userRepository.save).toHaveBeenCalledTimes(1);
      const savedUser = userRepository.save.mock.calls[0]![0];
      expect(savedUser.hasLocalPassword()).toBe(false);
      expect(savedUser.getPasswordHash()).toContain('$2b$12$FEDERATED_NO_LOCAL_PASSWORD_');

      // Verify FederatedIdentity was persisted
      const savedIdentity = await federatedIdentityRepo.findByProviderAndSubject('google', subjectId);
      expect(savedIdentity).not.toBeNull();
      expect(savedIdentity?.getUserId()).toBe(savedUser.getId());

      // Verify audit log
      const logs = auditLogger.getEvents();
      expect(logs.some((e) => e.eventType === 'client_authenticated' && e.metadata?.method === 'federation_jit_provisioned')).toBe(true);
    });
  });

  describe('Account Linking with Existing User', () => {
    it('should link federated identity to existing user by verified email without creating duplicate user', async () => {
      const existingUser = User.create({
        id: 'usr-existing-alice',
        email: Email.create(emailStr),
        tenantId: TenantId.create(tenantId),
        passwordHash: '$2b$10$hashedlocalpassword123',
      });
      userRepository.findByEmail.mockResolvedValue(existingUser);

      const result = await handler.execute({
        tenantId,
        userProfile: {
          provider: 'google',
          externalSubjectId: subjectId,
          email: emailStr,
          emailVerified: true,
        },
        clientId: 'spa-web-client',
      });

      expect(result.isNewUser).toBe(false);
      expect(result.linked).toBe(true);
      expect(result.user.id).toBe('usr-existing-alice');

      // No new user created
      expect(userRepository.save).not.toHaveBeenCalled();

      // FederatedIdentity linked to existing user
      const linkedIdentity = await federatedIdentityRepo.findByProviderAndSubject('google', subjectId);
      expect(linkedIdentity?.getUserId()).toBe('usr-existing-alice');

      // Verify audit log
      const logs = auditLogger.getEvents();
      expect(logs.some((e) => e.eventType === 'client_authenticated' && e.metadata?.method === 'federation_account_linked')).toBe(true);
    });
  });

  describe('Existing Linked Identity (Direct Sign-In)', () => {
    it('should directly sign in when identity was previously linked', async () => {
      const existingUser = User.create({
        id: 'usr-bob',
        email: Email.create(emailStr),
        tenantId: TenantId.create(tenantId),
        passwordHash: '$2b$10$hashedlocalpassword123',
      });

      const existingIdentity = FederatedIdentity.create({
        userId: 'usr-bob',
        tenantId: TenantId.create(tenantId),
        provider: 'google',
        externalSubjectId: subjectId,
        externalEmail: Email.create(emailStr),
      });
      await federatedIdentityRepo.save(existingIdentity);

      userRepository.findById.mockResolvedValue(existingUser);

      const result = await handler.execute({
        tenantId,
        userProfile: {
          provider: 'google',
          externalSubjectId: subjectId,
          email: emailStr,
          emailVerified: true,
        },
      });

      expect(result.isNewUser).toBe(false);
      expect(result.linked).toBe(false);
      expect(result.user.id).toBe('usr-bob');
      expect(userRepository.save).not.toHaveBeenCalled();

      const logs = auditLogger.getEvents();
      expect(logs.some((e) => e.eventType === 'client_authenticated' && e.metadata?.method === 'federation_existing_link')).toBe(true);
    });
  });

  describe('Multi-Provider Linking to Single User', () => {
    it('should allow linking multiple providers (Google and Microsoft) to the same local user', async () => {
      const existingUser = User.create({
        id: 'usr-multi-link',
        email: Email.create(emailStr),
        tenantId: TenantId.create(tenantId),
        passwordHash: '$2b$10$hashedlocalpassword123',
      });
      userRepository.findByEmail.mockResolvedValue(existingUser);

      // 1. Link Google
      await handler.execute({
        tenantId,
        userProfile: {
          provider: 'google',
          externalSubjectId: 'google-sub-1',
          email: emailStr,
          emailVerified: true,
        },
      });

      // 2. Link Microsoft
      const msResult = await handler.execute({
        tenantId,
        userProfile: {
          provider: 'microsoft',
          externalSubjectId: 'msft-oid-2',
          email: emailStr,
          emailVerified: true,
        },
      });

      expect(msResult.isNewUser).toBe(false);
      expect(msResult.linked).toBe(true);

      const allLinks = await federatedIdentityRepo.findAllByUserId('usr-multi-link', TenantId.create(tenantId));
      expect(allLinks).toHaveLength(2);
      expect(allLinks.map((l) => l.getProvider())).toEqual(expect.arrayContaining(['google', 'microsoft']));
    });
  });

  describe('Security Validations & Guards', () => {
    it('should reject linking or provisioning when emailVerified is false', async () => {
      await expect(
        handler.execute({
          tenantId,
          userProfile: {
            provider: 'google',
            externalSubjectId: subjectId,
            email: 'unverified@example.com',
            emailVerified: false,
          },
          ip: '10.0.0.99',
        })
      ).rejects.toThrow('Cannot link or provision account: google email "unverified@example.com" is not verified');

      expect(userRepository.save).not.toHaveBeenCalled();
      const logs = auditLogger.getEvents();
      expect(logs.some((e) => e.eventType === 'federation_callback_failed')).toBe(true);
    });

    it('should reject request and log security alert if existing identity belongs to a different tenant', async () => {
      const crossTenantIdentity = FederatedIdentity.create({
        userId: 'usr-attacker',
        tenantId: TenantId.create('beta-corp'), // Different tenant
        provider: 'google',
        externalSubjectId: subjectId,
        externalEmail: Email.create(emailStr),
      });
      await federatedIdentityRepo.save(crossTenantIdentity);

      await expect(
        handler.execute({
          tenantId: 'alpha-corp', // Attempting to access under alpha-corp
          userProfile: {
            provider: 'google',
            externalSubjectId: subjectId,
            email: emailStr,
            emailVerified: true,
          },
          ip: '203.0.113.42',
        })
      ).rejects.toThrow('Federated identity belongs to another tenant organization');

      const logs = auditLogger.getEvents();
      expect(logs.some((e) => e.eventType === 'cross_tenant_violation')).toBe(true);
    });

    it('should throw when existing identity references a nonexistent local user (inconsistent state)', async () => {
      const orphanedIdentity = FederatedIdentity.create({
        userId: 'usr-nonexistent',
        tenantId: TenantId.create(tenantId),
        provider: 'google',
        externalSubjectId: subjectId,
        externalEmail: Email.create(emailStr),
      });
      await federatedIdentityRepo.save(orphanedIdentity);
      userRepository.findById.mockResolvedValue(null);

      await expect(
        handler.execute({
          tenantId,
          userProfile: {
            provider: 'google',
            externalSubjectId: subjectId,
            email: emailStr,
            emailVerified: true,
          },
        })
      ).rejects.toThrow('Inconsistent federated state: linked user "usr-nonexistent" not found');
    });
  });
});
