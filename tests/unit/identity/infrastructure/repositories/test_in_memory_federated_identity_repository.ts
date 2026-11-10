import { InMemoryFederatedIdentityRepository } from '../../../../../src/contexts/identity/infrastructure/persistence/repositories/federated_identity/in_memory_federated_identity_repository';
import { FederatedIdentity } from '../../../../../src/contexts/identity/domain/entities/federated_identity/aggregate';
import { TenantId } from '../../../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { Email } from '../../../../../src/contexts/identity/domain/value_objects/email/value';

describe('Infrastructure Persistence: InMemoryFederatedIdentityRepository (US-11 Unit)', () => {
  let repository: InMemoryFederatedIdentityRepository;

  const tenantAlpha = TenantId.create('alpha-corp');
  const tenantBeta = TenantId.create('beta-corp');
  const user1 = 'usr-001';
  const email1 = Email.create('user1@example.com');

  beforeEach(() => {
    repository = new InMemoryFederatedIdentityRepository();
  });

  describe('save & findByProviderAndSubject', () => {
    it('should save and retrieve a federated identity by provider and external subject', async () => {
      const identity = FederatedIdentity.create({
        userId: user1,
        tenantId: tenantAlpha,
        provider: 'google',
        externalSubjectId: 'google-sub-100',
        externalEmail: email1,
      });

      await repository.save(identity);

      const found = await repository.findByProviderAndSubject('google', 'google-sub-100');
      expect(found).not.toBeNull();
      expect(found?.getId()).toBe(identity.getId());
      expect(found?.getUserId()).toBe(user1);
      expect(found?.getProvider()).toBe('google');
      expect(found?.getExternalSubjectId()).toBe('google-sub-100');
    });

    it('should return null when searching for an unregistered provider or subject', async () => {
      const found = await repository.findByProviderAndSubject('microsoft', 'unknown-subject');
      expect(found).toBeNull();
    });

    it('should update existing record idempotently on save with identical key', async () => {
      const original = FederatedIdentity.create({
        id: 'fed-1',
        userId: user1,
        tenantId: tenantAlpha,
        provider: 'google',
        externalSubjectId: 'google-sub-100',
        externalEmail: email1,
      });
      await repository.save(original);

      const updated = FederatedIdentity.create({
        id: 'fed-1-updated',
        userId: 'usr-002-reassigned',
        tenantId: tenantAlpha,
        provider: 'google',
        externalSubjectId: 'google-sub-100',
        externalEmail: Email.create('user2@example.com'),
      });
      await repository.save(updated);

      const retrieved = await repository.findByProviderAndSubject('google', 'google-sub-100');
      expect(retrieved?.getId()).toBe('fed-1-updated');
      expect(retrieved?.getUserId()).toBe('usr-002-reassigned');
    });
  });

  describe('findByUserIdAndProvider', () => {
    it('should find federated identity for matching userId, provider and tenant', async () => {
      const identity = FederatedIdentity.create({
        userId: user1,
        tenantId: tenantAlpha,
        provider: 'microsoft',
        externalSubjectId: 'ms-sub-200',
        externalEmail: email1,
      });
      await repository.save(identity);

      const found = await repository.findByUserIdAndProvider(user1, 'microsoft', tenantAlpha);
      expect(found).not.toBeNull();
      expect(found?.getExternalSubjectId()).toBe('ms-sub-200');
    });

    it('should return null if tenantId differs (tenant isolation)', async () => {
      const identity = FederatedIdentity.create({
        userId: user1,
        tenantId: tenantAlpha,
        provider: 'microsoft',
        externalSubjectId: 'ms-sub-200',
        externalEmail: email1,
      });
      await repository.save(identity);

      const found = await repository.findByUserIdAndProvider(user1, 'microsoft', tenantBeta);
      expect(found).toBeNull();
    });

    it('should return null if provider differs for the user', async () => {
      const identity = FederatedIdentity.create({
        userId: user1,
        tenantId: tenantAlpha,
        provider: 'google',
        externalSubjectId: 'g-sub-300',
        externalEmail: email1,
      });
      await repository.save(identity);

      const found = await repository.findByUserIdAndProvider(user1, 'microsoft', tenantAlpha);
      expect(found).toBeNull();
    });
  });

  describe('findAllByUserId', () => {
    it('should return all federated identities linked to a specific user in a tenant', async () => {
      const googleLink = FederatedIdentity.create({
        userId: user1,
        tenantId: tenantAlpha,
        provider: 'google',
        externalSubjectId: 'g-sub-1',
        externalEmail: email1,
      });
      const msLink = FederatedIdentity.create({
        userId: user1,
        tenantId: tenantAlpha,
        provider: 'microsoft',
        externalSubjectId: 'ms-sub-1',
        externalEmail: email1,
      });
      const otherUserLink = FederatedIdentity.create({
        userId: 'other-user',
        tenantId: tenantAlpha,
        provider: 'google',
        externalSubjectId: 'g-sub-2',
        externalEmail: Email.create('other@example.com'),
      });
      const otherTenantLink = FederatedIdentity.create({
        userId: user1,
        tenantId: tenantBeta,
        provider: 'google',
        externalSubjectId: 'g-sub-beta',
        externalEmail: email1,
      });

      await repository.save(googleLink);
      await repository.save(msLink);
      await repository.save(otherUserLink);
      await repository.save(otherTenantLink);

      const results = await repository.findAllByUserId(user1, tenantAlpha);
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.getProvider())).toEqual(expect.arrayContaining(['google', 'microsoft']));
    });

    it('should return an empty array if the user has no linked identities in that tenant', async () => {
      const results = await repository.findAllByUserId('unlinked-user', tenantAlpha);
      expect(results).toEqual([]);
    });
  });

  describe('clear', () => {
    it('should purge all stored identities from memory', async () => {
      const identity = FederatedIdentity.create({
        userId: user1,
        tenantId: tenantAlpha,
        provider: 'google',
        externalSubjectId: 'g-sub-purge',
        externalEmail: email1,
      });
      await repository.save(identity);

      repository.clear();

      const found = await repository.findByProviderAndSubject('google', 'g-sub-purge');
      expect(found).toBeNull();
    });
  });
});
