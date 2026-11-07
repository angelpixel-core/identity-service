import { ClientSecret } from '../../../../../src/contexts/identity/domain/value_objects/client_secret/value';
import { DomainValidationError } from '../../../../../src/contexts/identity/domain/exceptions/user/error';

describe('Value Object: ClientSecret (ADR-0004 & RFC 6749 Entropy Hardening)', () => {
  const validSecret32 = '12345678901234567890123456789012'; // exactly 32 chars
  const validSecretLong = 'SuperSecureSecretKeyForTestingClientCredentials_2026!'; // 53 chars

  describe('Creation and Invariants', () => {
    it('should successfully instantiate a ClientSecret with exactly 32 characters', () => {
      const secret = ClientSecret.create(validSecret32);

      expect(secret).toBeInstanceOf(ClientSecret);
      expect(secret.getValue()).toBe(validSecret32);
    });

    it('should successfully instantiate a ClientSecret with > 32 characters and trim whitespace', () => {
      const secret = ClientSecret.create(`  ${validSecretLong}  `);

      expect(secret).toBeInstanceOf(ClientSecret);
      expect(secret.getValue()).toBe(validSecretLong);
    });

    it('should throw DomainValidationError if secret is empty or only whitespace', () => {
      expect(() => ClientSecret.create('')).toThrow(DomainValidationError);
      expect(() => ClientSecret.create('   ')).toThrow(DomainValidationError);
    });

    it('should throw DomainValidationError if secret is null or undefined', () => {
      expect(() => ClientSecret.create(null as unknown as string)).toThrow(DomainValidationError);
      expect(() => ClientSecret.create(undefined as unknown as string)).toThrow(DomainValidationError);
    });

    it('should throw DomainValidationError if secret is shorter than 32 characters', () => {
      expect(() => ClientSecret.create('short-secret-123')).toThrow(DomainValidationError);
      expect(() => ClientSecret.create('1234567890123456789012345678901')).toThrow(DomainValidationError); // 31 chars
    });
  });

  describe('Equality and Redaction', () => {
    it('should return true for equals() with identical secret values', () => {
      const secretA = ClientSecret.create(validSecretLong);
      const secretB = ClientSecret.create(validSecretLong);

      expect(secretA.equals(secretB)).toBe(true);
    });

    it('should return false for equals() with different secret values', () => {
      const secretA = ClientSecret.create(validSecret32);
      const secretB = ClientSecret.create(validSecretLong);

      expect(secretA.equals(secretB)).toBe(false);
    });

    it('should return false for equals() with null, undefined, or non-ClientSecret objects', () => {
      const secret = ClientSecret.create(validSecret32);

      expect(secret.equals(null as unknown as ClientSecret)).toBe(false);
      expect(secret.equals(undefined as unknown as ClientSecret)).toBe(false);
      expect(secret.equals({ getValue: () => validSecret32 } as unknown as ClientSecret)).toBe(false);
    });

    it('should mask value as [REDACTED] in toString() to prevent accidental leakage in logs', () => {
      const secret = ClientSecret.create(validSecretLong);

      expect(secret.toString()).toBe('[REDACTED]');
      expect(`${secret}`).toBe('[REDACTED]');
    });
  });
});

