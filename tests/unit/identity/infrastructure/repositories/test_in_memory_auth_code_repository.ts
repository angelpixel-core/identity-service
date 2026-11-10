import { InMemoryAuthorizationCodeRepository } from '../../../../../src/contexts/identity/infrastructure/persistence/repositories/authorization_code/in_memory_repository';
import { AuthorizationCode } from '../../../../../src/contexts/identity/domain/entities/authorization_code/entity';
import { ClientId } from '../../../../../src/contexts/identity/domain/value_objects/client_id/value';
import { TenantId } from '../../../../../src/contexts/identity/domain/value_objects/tenant_id/value';

describe('Infrastructure Repository: InMemoryAuthorizationCodeRepository', () => {
  let repository: InMemoryAuthorizationCodeRepository;

  beforeEach(() => {
    repository = new InMemoryAuthorizationCodeRepository();
  });

  it('should save and retrieve an authorization code by code string', async () => {
    const authCode = AuthorizationCode.create({
      clientId: ClientId.create('client-app'),
      userId: 'user-1',
      tenantId: TenantId.create('tenant-1'),
      redirectUri: 'https://app.com/callback',
      scope: 'openid',
    });

    await repository.save(authCode);

    const found = await repository.findByCode(authCode.getCode());
    expect(found).not.toBeNull();
    expect(found?.getCode()).toBe(authCode.getCode());
    expect(found?.getClientId().getValue()).toBe('client-app');
  });

  it('should return null when code is not found', async () => {
    const found = await repository.findByCode('non-existent-code');
    expect(found).toBeNull();
  });

  it('should automatically purge expired code when findByCode is executed (lazy purge)', async () => {
    const authCode = AuthorizationCode.create({
      clientId: 'client-app',
      userId: 'user-1',
      tenantId: 'tenant-1',
      redirectUri: 'https://app.com/callback',
      scope: 'openid',
      ttlSeconds: -1, // Expired immediately
    });

    await repository.save(authCode);
    expect(repository.size()).toBe(1);

    const found = await repository.findByCode(authCode.getCode());
    expect(found).toBeNull();
    expect(repository.size()).toBe(0);
  });

  it('should delete all expired codes when deleteExpired is invoked', async () => {
    const validCode = AuthorizationCode.create({
      clientId: 'client-app',
      userId: 'user-valid',
      tenantId: 'tenant-1',
      redirectUri: 'https://app.com/callback',
      scope: 'openid',
      ttlSeconds: 300,
    });

    const expiredCode = AuthorizationCode.create({
      clientId: 'client-app',
      userId: 'user-expired',
      tenantId: 'tenant-1',
      redirectUri: 'https://app.com/callback',
      scope: 'openid',
      ttlSeconds: -10,
    });

    await repository.save(validCode);
    await repository.save(expiredCode);
    expect(repository.size()).toBe(2);

    await repository.deleteExpired(new Date());

    expect(repository.size()).toBe(1);
    expect(await repository.findByCode(validCode.getCode())).not.toBeNull();
    expect(await repository.findByCode(expiredCode.getCode())).toBeNull();
  });

  it('should clear all entries when clear() is called', async () => {
    const code = AuthorizationCode.create({
      clientId: 'client-app',
      userId: 'user-1',
      tenantId: 'tenant-1',
      redirectUri: 'https://app.com/callback',
      scope: 'openid',
    });

    await repository.save(code);
    expect(repository.size()).toBe(1);

    repository.clear();
    expect(repository.size()).toBe(0);
  });
});
