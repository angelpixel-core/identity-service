import { InMemoryRefreshSessionRepository } from '../../../../../src/contexts/identity/infrastructure/persistence/repositories/refresh_session/in_memory_repository';
import { RefreshSession } from '../../../../../src/contexts/identity/domain/entities/refresh_session/aggregate';

describe('Infrastructure Repository: InMemoryRefreshSessionRepository', () => {
  let repository: InMemoryRefreshSessionRepository;

  beforeEach(() => {
    repository = new InMemoryRefreshSessionRepository();
  });

  it('should save and retrieve a session by tokenHash', async () => {
    const { session } = RefreshSession.create({
      familyId: 'fam-test-1',
      userId: 'usr-1',
      tenantId: 'tenant-1',
      clientId: 'client-1',
    });

    await repository.save(session);
    const retrieved = await repository.findByTokenHash(session.getTokenHash());

    expect(retrieved).not.toBeNull();
    expect(retrieved?.getId()).toBe(session.getId());
    expect(retrieved?.getFamilyId()).toBe('fam-test-1');
  });

  it('should return null when tokenHash is not found', async () => {
    const retrieved = await repository.findByTokenHash('non_existent_hash');
    expect(retrieved).toBeNull();
  });

  it('should perform lazy cleanup when retrieving an expired session', async () => {
    const pastExpiresAt = new Date(Date.now() - 5000);
    const { session } = RefreshSession.create({
      userId: 'usr-expired',
      tenantId: 'tenant-1',
      clientId: 'client-1',
      expiresAt: pastExpiresAt,
    });

    await repository.save(session);
    expect(repository.size()).toBe(1);

    const retrieved = await repository.findByTokenHash(session.getTokenHash());
    expect(retrieved).toBeNull();
    expect(repository.size()).toBe(0);
  });

  it('should find all sessions belonging to a specific family', async () => {
    const familyId = 'fam-shared-1';
    const { session: s1 } = RefreshSession.create({
      familyId,
      userId: 'usr-1',
      tenantId: 'tenant-1',
      clientId: 'client-1',
    });
    const { session: s2 } = RefreshSession.create({
      familyId,
      userId: 'usr-1',
      tenantId: 'tenant-1',
      clientId: 'client-1',
    });
    const { session: sOther } = RefreshSession.create({
      familyId: 'fam-other',
      userId: 'usr-2',
      tenantId: 'tenant-1',
      clientId: 'client-1',
    });

    await repository.save(s1);
    await repository.save(s2);
    await repository.save(sOther);

    const familySessions = await repository.findByFamilyId(familyId);
    expect(familySessions).toHaveLength(2);
    expect(familySessions.map((s) => s.getId())).toEqual(expect.arrayContaining([s1.getId(), s2.getId()]));
  });

  it('should revoke all sessions in a family via revokeFamily', async () => {
    const familyId = 'fam-revocation';
    const { session: s1 } = RefreshSession.create({
      familyId,
      userId: 'usr-1',
      tenantId: 'tenant-1',
      clientId: 'client-1',
    });
    const { session: s2 } = RefreshSession.create({
      familyId,
      userId: 'usr-1',
      tenantId: 'tenant-1',
      clientId: 'client-1',
    });

    await repository.save(s1);
    await repository.save(s2);

    await repository.revokeFamily(familyId, 'reuse_detected');

    const familySessions = await repository.findByFamilyId(familyId);
    expect(familySessions.every((s) => s.isRevoked())).toBe(true);
    expect(familySessions.every((s) => s.getRevocationReason() === 'reuse_detected')).toBe(true);
  });

  it('should delete expired sessions and return count via deleteExpired', async () => {
    const pastExpiresAt = new Date(Date.now() - 5000);
    const futureExpiresAt = new Date(Date.now() + 60000);

    const { session: sExpired1 } = RefreshSession.create({
      userId: 'usr-1',
      tenantId: 'tenant-1',
      clientId: 'client-1',
      expiresAt: pastExpiresAt,
    });
    const { session: sExpired2 } = RefreshSession.create({
      userId: 'usr-2',
      tenantId: 'tenant-1',
      clientId: 'client-1',
      expiresAt: pastExpiresAt,
    });
    const { session: sActive } = RefreshSession.create({
      userId: 'usr-3',
      tenantId: 'tenant-1',
      clientId: 'client-1',
      expiresAt: futureExpiresAt,
    });

    await repository.save(sExpired1);
    await repository.save(sExpired2);
    await repository.save(sActive);

    const count = await repository.deleteExpired();
    expect(count).toBe(2);
    expect(repository.size()).toBe(1);
  });

  it('should trigger auto-purge threshold after 50 operations', async () => {
    const pastExpiresAt = new Date(Date.now() - 5000);
    const { session: sExpired } = RefreshSession.create({
      userId: 'usr-expired',
      tenantId: 'tenant-1',
      clientId: 'client-1',
      expiresAt: pastExpiresAt,
    });
    await repository.save(sExpired);

    // Save 49 dummy sessions to cross the AUTO_PURGE_THRESHOLD (50)
    for (let i = 0; i < 49; i++) {
      const { session } = RefreshSession.create({
        userId: `usr-dummy-${i}`,
        tenantId: 'tenant-1',
        clientId: 'client-1',
      });
      await repository.save(session);
    }

    // sExpired must have been purged automatically
    const retrieved = await repository.findByTokenHash(sExpired.getTokenHash());
    expect(retrieved).toBeNull();
  });

  it('should clear all entries via clear()', async () => {
    const { session } = RefreshSession.create({
      userId: 'usr-1',
      tenantId: 'tenant-1',
      clientId: 'client-1',
    });
    await repository.save(session);
    expect(repository.size()).toBe(1);

    await repository.clear();
    expect(repository.size()).toBe(0);
  });
});

