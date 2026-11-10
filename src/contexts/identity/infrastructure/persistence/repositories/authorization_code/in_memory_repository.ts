import { AuthorizationCode } from '../../../../domain/entities/authorization_code/entity';
import { AuthorizationCodeRepositoryPort } from '../../../../domain/ports/authorization_code_repository_port';

/**
 * Secondary Adapter: InMemoryAuthorizationCodeRepository
 * Implementación de persistencia volátil en memoria para códigos de autorización efímeros.
 */
export class InMemoryAuthorizationCodeRepository implements AuthorizationCodeRepositoryPort {
  private static readonly AUTO_PURGE_THRESHOLD = 50;
  private readonly codes: Map<string, AuthorizationCode> = new Map();

  public async save(authorizationCode: AuthorizationCode): Promise<void> {
    if (this.codes.size >= InMemoryAuthorizationCodeRepository.AUTO_PURGE_THRESHOLD) {
      await this.deleteExpired();
    }
    this.codes.set(authorizationCode.getCode(), authorizationCode);
  }

  public async findByCode(code: string): Promise<AuthorizationCode | null> {
    const authCode = this.codes.get(code);
    if (!authCode) {
      return null;
    }
    if (authCode.isExpired()) {
      this.codes.delete(code);
      return null;
    }
    return authCode;
  }

  public async deleteExpired(now: Date = new Date()): Promise<void> {
    for (const [code, authCode] of this.codes.entries()) {
      if (authCode.isExpired(now)) {
        this.codes.delete(code);
      }
    }
  }

  public size(): number {
    return this.codes.size;
  }

  public clear(): void {
    this.codes.clear();
  }
}