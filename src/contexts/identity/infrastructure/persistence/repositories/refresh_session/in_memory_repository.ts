import { RefreshSession } from '../../../../domain/entities/refresh_session/aggregate';
import { RefreshSessionRepositoryPort } from '../../../../domain/ports/repositories/refresh_session_repository_port';

/**
 * Adaptador de Infraestructura: InMemoryRefreshSessionRepository
 * Implementación en memoria con indexación dual (ID y tokenHash) y soporte para
 * revocación atómica de familias completas (Token Family Revocation).
 */
export class InMemoryRefreshSessionRepository implements RefreshSessionRepositoryPort {
  public static readonly AUTO_PURGE_THRESHOLD = 50;

  private readonly sessionsById: Map<string, RefreshSession> = new Map();
  private readonly sessionIdsByHash: Map<string, string> = new Map();
  private operationCount = 0;

  public async save(session: RefreshSession): Promise<void> {
    this.sessionsById.set(session.getId(), session);
    this.sessionIdsByHash.set(session.getTokenHash(), session.getId());

    this.operationCount++;
    if (this.operationCount >= InMemoryRefreshSessionRepository.AUTO_PURGE_THRESHOLD) {
      await this.deleteExpired();
      this.operationCount = 0;
    }
  }

  public async findByTokenHash(tokenHash: string): Promise<RefreshSession | null> {
    const sessionId = this.sessionIdsByHash.get(tokenHash);
    if (!sessionId) {
      return null;
    }
    const session = this.sessionsById.get(sessionId);
    if (!session) {
      this.sessionIdsByHash.delete(tokenHash);
      return null;
    }

    if (session.isExpired()) {
      // Lazy cleanup
      this.sessionsById.delete(session.getId());
      this.sessionIdsByHash.delete(tokenHash);
      return null;
    }

    return session;
  }

  public async findByFamilyId(familyId: string): Promise<RefreshSession[]> {
    const results: RefreshSession[] = [];
    for (const session of this.sessionsById.values()) {
      if (session.getFamilyId() === familyId) {
        results.push(session);
      }
    }
    return results;
  }

  public async revokeFamily(familyId: string, reason: string): Promise<void> {
    const now = new Date();
    for (const session of this.sessionsById.values()) {
      if (session.getFamilyId() === familyId) {
        session.revoke(reason, now);
      }
    }
  }

  public async deleteExpired(): Promise<number> {
    const now = new Date();
    let deletedCount = 0;
    for (const [id, session] of Array.from(this.sessionsById.entries())) {
      if (session.isExpired(now)) {
        this.sessionsById.delete(id);
        this.sessionIdsByHash.delete(session.getTokenHash());
        deletedCount++;
      }
    }
    return deletedCount;
  }

  public async clear(): Promise<void> {
    this.sessionsById.clear();
    this.sessionIdsByHash.clear();
  }

  public size(): number {
    return this.sessionsById.size;
  }
}

