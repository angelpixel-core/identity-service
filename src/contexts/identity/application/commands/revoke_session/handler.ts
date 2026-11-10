import { RevokeSessionCommand } from './command';
import { RefreshSessionRepositoryPort } from '../../../domain/ports/repositories/refresh_session_repository_port';
import { RefreshSession } from '../../../domain/entities/refresh_session/aggregate';

/**
 * Caso de Uso: RevokeSessionCommandHandler
 * Revoca explícitamente una sesión o token de refresco (Logout / RFC 7009).
 */
export class RevokeSessionCommandHandler {
  constructor(private readonly sessionRepository: RefreshSessionRepositoryPort) {}

  public async execute(command: RevokeSessionCommand): Promise<void> {
    if (!command.refreshToken || typeof command.refreshToken !== 'string' || command.refreshToken.trim().length === 0) {
      // RFC 7009: Invalid tokens still return success or no-op
      return;
    }

    let tokenHash: string;
    try {
      tokenHash = RefreshSession.hashToken(command.refreshToken.trim());
    } catch {
      // RFC 7009: Invalid token submitted returns gracefully
      return;
    }

    const session = await this.sessionRepository.findByTokenHash(tokenHash);

    if (session) {
      session.revoke(command.reason || 'user_logout');
      await this.sessionRepository.save(session);
      await this.sessionRepository.revokeFamily(session.getFamilyId(), command.reason || 'user_logout');
    }
  }
}

