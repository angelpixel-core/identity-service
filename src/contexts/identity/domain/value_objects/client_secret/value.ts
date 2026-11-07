import { DomainValidationError } from '../../exceptions/user/error';

/**
 * Value Object: ClientSecret
 * Credencial secreta, inmutable y segura para aplicaciones cliente confidenciales.
 * Garantiza entropía criptográfica mínima exigiendo una longitud >= 32 caracteres (ADR-0004 / RFC 6749 BCP).
 */
export class ClientSecret {
  public static readonly MIN_LENGTH = 32;

  private readonly value: string;

  private constructor(value: string) {
    this.value = Object.freeze(value);
    Object.freeze(this);
  }

  public static create(rawSecret: string): ClientSecret {
    if (!rawSecret || typeof rawSecret !== 'string') {
      throw new DomainValidationError('ClientSecret must be a non-empty string');
    }

    const trimmed = rawSecret.trim();
    if (trimmed.length === 0) {
      throw new DomainValidationError('ClientSecret cannot be empty or whitespace');
    }

    if (trimmed.length < ClientSecret.MIN_LENGTH) {
      throw new DomainValidationError(
        `ClientSecret is too short. Minimum length is ${ClientSecret.MIN_LENGTH} characters.`
      );
    }

    return new ClientSecret(trimmed);
  }

  public getValue(): string {
    return this.value;
  }

  public equals(other: ClientSecret): boolean {
    if (!other || !(other instanceof ClientSecret)) {
      return false;
    }

    return this.value === other.getValue();
  }

  /**
   * Enmascaramiento de seguridad para evitar fuga accidental en logs o trazas.
   */
  public toString(): string {
    return '[REDACTED]';
  }
}

