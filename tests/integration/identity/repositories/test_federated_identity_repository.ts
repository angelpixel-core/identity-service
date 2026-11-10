import { PostgresFederatedIdentityRepository } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/federated_identity/postgres_federated_identity_repository';
import { InMemoryFederatedIdentityRepository } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/federated_identity/in_memory_federated_identity_repository';
import { FederatedIdentity } from '../../../../src/contexts/identity/domain/entities/federated_identity/aggregate';
import { TenantId } from '../../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { Email } from '../../../../src/contexts/identity/domain/value_objects/email/value';
import { DatabaseClient } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/user/repository';

describe('Integration: Federated Identity Repositories (US-11)', () => {
  describe('InMemoryFederatedIdentityRepository', () => {
    let repo: InMemoryFederatedIdentityRepository;

    beforeEach(() => {
      repo = new InMemoryFederatedIdentityRepository();
    });

    it('should save and find federated identity by provider and subject', async () => {
      const identity = FederatedIdentity.create({
        userId: 'user-123',
        tenantId: TenantId.create('tenant-alpha'),
        provider: 'google',
        externalSubjectId: 'g-1001',
        externalEmail: Email.create('user@alpha.com'),
      });

      await repo.save(identity);

      const found = await repo.findByProviderAndSubject('google', 'g-1001');
      expect(found).not.toBeNull();
      expect(found?.getUserId()).toBe('user-123');
      expect(found?.getTenantId().getValue()).toBe('tenant-alpha');
      expect(found?.getExternalEmail().getValue()).toBe('user@alpha.com');
    });

    it('should find federated identity by userId, provider and tenantId', async () => {
      const identity = FederatedIdentity.create({
        userId: 'user-456',
        tenantId: TenantId.create('tenant-beta'),
        provider: 'microsoft',
        externalSubjectId: 'ms-2002',
        externalEmail: Email.create('user@beta.com'),
      });

      await repo.save(identity);

      const found = await repo.findByUserIdAndProvider('user-456', 'microsoft', TenantId.create('tenant-beta'));
      expect(found).not.toBeNull();
      expect(found?.getExternalSubjectId()).toBe('ms-2002');

      const notFoundWrongTenant = await repo.findByUserIdAndProvider('user-456', 'microsoft', TenantId.create('tenant-other'));
      expect(notFoundWrongTenant).toBeNull();
    });

    it('should find all federated identities for a user in a tenant', async () => {
      const googleId = FederatedIdentity.create({
        userId: 'user-multi',
        tenantId: TenantId.create('tenant-gamma'),
        provider: 'google',
        externalSubjectId: 'g-3001',
        externalEmail: Email.create('multi@gamma.com'),
      });
      const msftId = FederatedIdentity.create({
        userId: 'user-multi',
        tenantId: TenantId.create('tenant-gamma'),
        provider: 'microsoft',
        externalSubjectId: 'ms-3002',
        externalEmail: Email.create('multi@gamma.com'),
      });

      await repo.save(googleId);
      await repo.save(msftId);

      const all = await repo.findAllByUserId('user-multi', TenantId.create('tenant-gamma'));
      expect(all).toHaveLength(2);
      expect(all.map((i) => i.getProvider())).toEqual(['google', 'microsoft']);
    });
  });

  describe('PostgresFederatedIdentityRepository (Mock Database Client)', () => {
    let mockClient: DatabaseClient;
    let queries: { sql: string; params?: any[] }[];

    beforeEach(() => {
      queries = [];
      mockClient = {
        query: async <T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }> => {
          queries.push({ sql, params });
          if (sql.includes('SELECT') && params?.includes('g-existing')) {
            return {
              rows: [
                {
                  id: 'fed-uuid-1',
                  user_id: 'user-pg-1',
                  tenant_id: 'tenant-pg',
                  provider: 'google',
                  external_subject_id: 'g-existing',
                  external_email: 'existing@pg.com',
                  created_at: new Date(),
                  updated_at: new Date(),
                } as unknown as T,
              ],
            };
          }
          return { rows: [] };
        },
      };
    });

    it('should execute parameterized INSERT ON CONFLICT for save', async () => {
      const repo = new PostgresFederatedIdentityRepository(mockClient);
      const identity = FederatedIdentity.create({
        id: 'fed-pg-id-1',
        userId: 'user-pg-1',
        tenantId: TenantId.create('tenant-pg'),
        provider: 'google',
        externalSubjectId: 'g-new-1',
        externalEmail: Email.create('new@pg.com'),
      });

      await repo.save(identity);

      expect(queries).toHaveLength(1);
      expect(queries[0]!.sql).toContain('INSERT INTO federated_identities');
      expect(queries[0]!.sql).toContain('ON CONFLICT (id) DO UPDATE');
      expect(queries[0]!.params).toEqual(
        expect.arrayContaining(['fed-pg-id-1', 'user-pg-1', 'tenant-pg', 'google', 'g-new-1', 'new@pg.com'])
      );
    });

    it('should execute parameterized SELECT for findByProviderAndSubject', async () => {
      const repo = new PostgresFederatedIdentityRepository(mockClient);
      const result = await repo.findByProviderAndSubject('google', 'g-existing');

      expect(queries).toHaveLength(1);
      expect(queries[0]!.sql).toContain('WHERE provider = $1 AND external_subject_id = $2');
      expect(queries[0]!.params).toEqual(['google', 'g-existing']);
      expect(result).not.toBeNull();
      expect(result?.getUserId()).toBe('user-pg-1');
    });

    it('should support withClient for transactional RLS scoping', () => {
      const repo = new PostgresFederatedIdentityRepository(mockClient);
      const newClient: DatabaseClient = { query: async () => ({ rows: [] }) };
      const boundRepo = repo.withClient(newClient);
      expect(boundRepo).toBeInstanceOf(PostgresFederatedIdentityRepository);
    });
  });
});
