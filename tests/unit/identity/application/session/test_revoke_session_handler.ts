import { RevokeSessionCommandHandler } from '../../../../../src/contexts/identity/application/commands/revoke_session/handler';
import { InMemoryRefreshSessionRepository } from '../../../../../src/contexts/identity/infrastructure/persistence/repositories/refresh_session/in_memory_repository';
import { RefreshSession } from '../../../../../src/contexts/identity/domain/entities/refresh_session/aggregate';

describe('Application Command: RevokeSessionCommandHandler (RFC 7009 & US-09)', () => {
  let sessionRepository: InMemoryRefreshSessionRepository;
  let handler: RevokeSessionCommandHandler;

  beforeEach(() => {
    sessionRepository = new InMemoryRefreshSessionRepository();
    handler = new RevokeSessionCommandHandler(sessionRepository);
  });

  it('should successfully revoke session and its entire family when valid token is supplied', async () => {
    const familyId = 'fam-revoke-unit';
    const { session: s1, plainToken } = RefreshSession.create({
      familyId,
      userId: 'usr-1',
      tenantId: 'tenant-1',
      clientId: 'client-1',
    });
    const childHash = RefreshSession.hashToken(RefreshSession.generatePlainToken());
    const s2 = s1.rotate(childHash);

    await sessionRepository.save(s1);
    await sessionRepository.save(s2);

    await handler.execute({
      refreshToken: plainToken,
      reason: 'user_logout',
    });

    const family = await sessionRepository.findByFamilyId(familyId);
    expect(family.every((s) => s.isRevoked())).toBe(true);
    expect(family.every((s) => s.getRevocationReason() === 'user_logout')).toBe(true);
  });

  it('should handle empty or whitespace refreshToken gracefully without error (RFC 7009)', async () => {
    await expect(
      handler.execute({
        refreshToken: '',
      })
    ).resolves.toBeUndefined();

    await expect(
      handler.execute({
        refreshToken: '   ',
      })
    ).resolves.toBeUndefined();
  });

  it('should handle unknown or malformed tokens gracefully without error (RFC 7009)', async () => {
    await expect(
      handler.execute({
        refreshToken: 'non_existent_token_string_longer_than_16_chars',
      })
    ).resolves.toBeUndefined();

    await expect(
      handler.execute({
        refreshToken: 'short',
      })
    ).resolves.toBeUndefined();
  });
});

