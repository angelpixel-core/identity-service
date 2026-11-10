import crypto from 'crypto';
import { DomainValidationError } from '../exceptions/user/error';

/**
 * Servicio de Dominio: PkceValidator
 * Implementa las operaciones y validaciones criptográficas de PKCE según RFC 7636.
 */
export class PkceValidator {
  /**
   * Conjunto de caracteres no reservados según RFC 7636 Sección 4.1:
   * [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
   */
  private static readonly CODE_VERIFIER_REGEX = /^[A-Za-z0-9\-._~]+$/;
  public static readonly MIN_VERIFIER_LENGTH = 43;
  public static readonly MAX_VERIFIER_LENGTH = 128;

  /**
   * Valida la sintaxis, longitud y caracteres de un code_verifier (RFC 7636 Sección 4.1).
   */
  public static validateVerifierFormat(codeVerifier: string): void {
    if (!codeVerifier || typeof codeVerifier !== 'string') {
      throw new DomainValidationError('code_verifier must be a non-empty string');
    }

    if (
      codeVerifier.length < PkceValidator.MIN_VERIFIER_LENGTH ||
      codeVerifier.length > PkceValidator.MAX_VERIFIER_LENGTH
    ) {
      throw new DomainValidationError(
        `code_verifier length must be between ${PkceValidator.MIN_VERIFIER_LENGTH} and ${PkceValidator.MAX_VERIFIER_LENGTH} characters. Provided: ${codeVerifier.length}`
      );
    }

    if (!PkceValidator.CODE_VERIFIER_REGEX.test(codeVerifier)) {
      throw new DomainValidationError(
        'code_verifier contains invalid characters. Allowed: [A-Za-z0-9-._~]'
      );
    }
  }

  /**
   * Calcula el code_challenge utilizando el algoritmo S256 (RFC 7636 Sección 4.2):
   * code_challenge = BASE64URL(SHA256(ASCII(code_verifier)))
   */
  public static computeS256Challenge(codeVerifier: string): string {
    PkceValidator.validateVerifierFormat(codeVerifier);
    return crypto.createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
  }

  /**
   * Verifica criptográficamente si un code_verifier coincide con el code_challenge registrado.
   * Utiliza crypto.timingSafeEqual para proteger contra ataques de canal lateral de temporización.
   */
  public static verify(
    codeVerifier: string,
    codeChallenge: string,
    method: string = 'S256'
  ): boolean {
    if (method !== 'S256') {
      return false;
    }

    try {
      PkceValidator.validateVerifierFormat(codeVerifier);
    } catch {
      return false;
    }

    if (!codeChallenge || typeof codeChallenge !== 'string' || codeChallenge.trim().length === 0) {
      return false;
    }

    const expectedChallenge = PkceValidator.computeS256Challenge(codeVerifier);

    const expectedBuffer = Buffer.from(expectedChallenge, 'utf8');
    const providedBuffer = Buffer.from(codeChallenge, 'utf8');

    if (expectedBuffer.length !== providedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
  }
}

