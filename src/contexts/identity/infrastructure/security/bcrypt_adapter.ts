import bcrypt from 'bcrypt';
import { HashProviderPort } from '../../application/ports/security/hash_provider';

/**
 * Infrastructure Adapter: BcryptAdapter
 * Implementación concreta del puerto HashProviderPort utilizando la librería bcrypt.
 * Aplica salting dinámico criptográfico para proteger las credenciales contra ataques
 * de rainbow tables y fuerza bruta.
 */
export class BcryptAdapter implements HashProviderPort {
  constructor(private readonly saltRounds: number = 10) {}

  public async hash(plainText: string): Promise<string> {
    if (!plainText || typeof plainText !== 'string' || plainText.trim().length === 0) {
      throw new Error('Plain text password must be a non-empty string to hash');
    }

    return bcrypt.hash(plainText, this.saltRounds);
  }

  public async compare(plainText: string, hashedText: string): Promise<boolean> {
    if (
      !plainText ||
      !hashedText ||
      typeof plainText !== 'string' ||
      typeof hashedText !== 'string' ||
      hashedText.trim().length === 0
    ) {
      return false;
    }

    try {
      return await bcrypt.compare(plainText, hashedText);
    } catch {
      return false;
    }
  }
}

