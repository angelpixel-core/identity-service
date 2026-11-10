import { PkceValidator } from '../../../../../src/contexts/identity/domain/services/pkce_validator';
import { DomainValidationError } from '../../../../../src/contexts/identity/domain/exceptions/user/error';

describe('Domain Service: PkceValidator (RFC 7636 Proof Key for Code Exchange)', () => {
  // Official test vectors from RFC 7636 Appendix B
  const validVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const expectedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

  describe('validateVerifierFormat', () => {
    it('should validate an RFC 7636 compliant code_verifier successfully', () => {
      expect(() => PkceValidator.validateVerifierFormat(validVerifier)).not.toThrow();
    });

    it('should accept verifiers with minimum allowed length (43 characters)', () => {
      const minLengthVerifier = 'a'.repeat(43);
      expect(() => PkceValidator.validateVerifierFormat(minLengthVerifier)).not.toThrow();
    });

    it('should accept verifiers with maximum allowed length (128 characters)', () => {
      const maxLengthVerifier = 'b'.repeat(128);
      expect(() => PkceValidator.validateVerifierFormat(maxLengthVerifier)).not.toThrow();
    });

    it('should accept all unreserved characters: [A-Za-z0-9-._~]', () => {
      const unreservedChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~-._~';
      expect(() => PkceValidator.validateVerifierFormat(unreservedChars)).not.toThrow();
    });

    it('should throw DomainValidationError when verifier is shorter than 43 characters', () => {
      const shortVerifier = 'a'.repeat(42);
      expect(() => PkceValidator.validateVerifierFormat(shortVerifier)).toThrow(DomainValidationError);
      expect(() => PkceValidator.validateVerifierFormat(shortVerifier)).toThrow(/length must be between 43 and 128/);
    });

    it('should throw DomainValidationError when verifier is longer than 128 characters', () => {
      const longVerifier = 'a'.repeat(129);
      expect(() => PkceValidator.validateVerifierFormat(longVerifier)).toThrow(DomainValidationError);
      expect(() => PkceValidator.validateVerifierFormat(longVerifier)).toThrow(/length must be between 43 and 128/);
    });

    it('should throw DomainValidationError when verifier contains reserved/forbidden characters', () => {
      const invalidChars = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk+=='; // + and = are invalid in verifier
      expect(() => PkceValidator.validateVerifierFormat(invalidChars)).toThrow(DomainValidationError);
      expect(() => PkceValidator.validateVerifierFormat(invalidChars)).toThrow(/invalid characters/);
    });

    it('should throw DomainValidationError for empty or non-string inputs', () => {
      expect(() => PkceValidator.validateVerifierFormat('')).toThrow(DomainValidationError);
      expect(() => PkceValidator.validateVerifierFormat(null as any)).toThrow(DomainValidationError);
      expect(() => PkceValidator.validateVerifierFormat(undefined as any)).toThrow(DomainValidationError);
    });
  });

  describe('computeS256Challenge', () => {
    it('should accurately compute S256 challenge matching RFC 7636 Appendix B test vector', () => {
      const challenge = PkceValidator.computeS256Challenge(validVerifier);
      expect(challenge).toBe(expectedChallenge);
    });

    it('should throw DomainValidationError when computing challenge from an invalid verifier', () => {
      expect(() => PkceValidator.computeS256Challenge('too_short')).toThrow(DomainValidationError);
    });
  });

  describe('verify', () => {
    it('should return true for valid code_verifier and code_challenge pair', () => {
      const isValid = PkceValidator.verify(validVerifier, expectedChallenge, 'S256');
      expect(isValid).toBe(true);
    });

    it('should return false when code_verifier does not match code_challenge', () => {
      const wrongVerifier = 'wrong_verifier_string_at_least_43_characters_long_for_testing';
      const isValid = PkceValidator.verify(wrongVerifier, expectedChallenge, 'S256');
      expect(isValid).toBe(false);
    });

    it('should return false for unsupported code_challenge_method (e.g. plain or S512)', () => {
      const isValid = PkceValidator.verify(validVerifier, expectedChallenge, 'plain');
      expect(isValid).toBe(false);
    });

    it('should return false when code_challenge is empty or whitespace', () => {
      expect(PkceValidator.verify(validVerifier, '', 'S256')).toBe(false);
      expect(PkceValidator.verify(validVerifier, '   ', 'S256')).toBe(false);
      expect(PkceValidator.verify(validVerifier, null as any, 'S256')).toBe(false);
    });

    it('should return false gracefully when code_verifier violates format', () => {
      expect(PkceValidator.verify('too_short', expectedChallenge, 'S256')).toBe(false);
      expect(PkceValidator.verify('', expectedChallenge, 'S256')).toBe(false);
    });
  });
});
