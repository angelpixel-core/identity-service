import { UserRepositoryPort } from '../../../../src/contexts/identity/application/ports/user/repository';
import { HashProviderPort } from '../../../../src/contexts/identity/application/ports/security/hash_provider';
import {
  TokenProviderPort,
  AuthTokenClaims,
} from '../../../../src/contexts/identity/application/ports/security/token_provider';
import { User } from '../../../../src/contexts/identity/domain/entities/user/aggregate';
import { Email } from '../../../../src/contexts/identity/domain/value_objects/email/value';
import { TenantId } from '../../../../src/contexts/identity/domain/value_objects/tenant_id/value';

describe('Application Secondary Ports (SPIs) Contracts', () => {
  it('should allow implementing UserRepositoryPort with InMemory fake', async () => {
    class InMemoryUserRepository implements UserRepositoryPort {
      private users: User[] = [];

      async save(user: User): Promise<void> {
        this.users.push(user);
      }

      async findById(id: string, tenantId: TenantId): Promise<User | null> {
        return (
          this.users.find((u) => u.getId() === id && u.getTenantId().equals(tenantId)) || null
        );
      }

      async findByEmail(email: Email, tenantId: TenantId): Promise<User | null> {
        return (
          this.users.find((u) => u.getEmail().equals(email) && u.getTenantId().equals(tenantId)) ||
          null
        );
      }

      async delete(id: string, tenantId: TenantId): Promise<boolean> {
        const initialLength = this.users.length;
        this.users = this.users.filter(
          (u) => !(u.getId() === id && u.getTenantId().equals(tenantId))
        );
        return this.users.length < initialLength;
      }
    }

    const repo: UserRepositoryPort = new InMemoryUserRepository();
    const user = User.create({
      id: 'usr-1',
      email: Email.create('test@acme.com'),
      tenantId: TenantId.create('acme'),
      passwordHash: 'hash-abc',
    });

    await repo.save(user);

    const found = await repo.findByEmail(Email.create('test@acme.com'), TenantId.create('acme'));
    expect(found).not.toBeNull();
    expect(found?.getId()).toBe('usr-1');

    const notFoundOtherTenant = await repo.findByEmail(
      Email.create('test@acme.com'),
      TenantId.create('other-corp')
    );
    expect(notFoundOtherTenant).toBeNull();
  });

  it('should allow implementing HashProviderPort with Mock/Fake', async () => {
    class FakeHashProvider implements HashProviderPort {
      async hash(plainText: string): Promise<string> {
        return `fake-hash-${plainText}`;
      }

      async compare(plainText: string, hashedText: string): Promise<boolean> {
        return hashedText === `fake-hash-${plainText}`;
      }
    }

    const hasher: HashProviderPort = new FakeHashProvider();
    const hashed = await hasher.hash('Secret123!');
    expect(hashed).toBe('fake-hash-Secret123!');
    expect(await hasher.compare('Secret123!', hashed)).toBe(true);
    expect(await hasher.compare('WrongPassword', hashed)).toBe(false);
  });

  it('should allow implementing TokenProviderPort with Mock/Fake', async () => {
    class FakeTokenProvider implements TokenProviderPort {
      async generateToken(claims: AuthTokenClaims): Promise<string> {
        return `token:${claims.tenantId}:${claims.userId}:${claims.email}`;
      }

      async verifyToken(token: string): Promise<AuthTokenClaims> {
        const [, tenantId, userId, email] = token.split(':');
        return {
          tenantId: tenantId || '',
          userId: userId || '',
          email: email || '',
        };
      }
    }

    const tokenProvider: TokenProviderPort = new FakeTokenProvider();
    const token = await tokenProvider.generateToken({
      userId: 'usr-1',
      email: 'user@acme.com',
      tenantId: 'acme-corp',
    });

    expect(token).toBe('token:acme-corp:usr-1:user@acme.com');
    const verified = await tokenProvider.verifyToken(token);
    expect(verified.tenantId).toBe('acme-corp');
    expect(verified.userId).toBe('usr-1');
    expect(verified.email).toBe('user@acme.com');
  });
});