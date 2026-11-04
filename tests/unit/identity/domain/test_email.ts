// Intentionally importing Value Objects to test before implementation (TDD RED)
// @ts-expect-error - Module will be created in src/contexts/identity/domain/value_objects/email/value.ts
import { Email } from '../../../../src/contexts/identity/domain/value_objects/email/value';
// @ts-expect-error - Module will be created in src/contexts/identity/domain/exceptions/user/error.ts
import { DomainValidationError } from '../../../../src/contexts/identity/domain/exceptions/user/error';

describe('Value Object: Email', () => {
  describe('Valid Email Instantiation', () => {
    it('should create an Email instance for standard valid email', () => {
      const email = Email.create('user@acme.com');
      expect(email.getValue()).toBe('user@acme.com');
    });

    it('should normalize email to lowercase and trim whitespace', () => {
      const email = Email.create('  User.Name+Tag@ACME.COM  ');
      expect(email.getValue()).toBe('user.name+tag@acme.com');
    });

    it('should correctly evaluate value equality with equals()', () => {
      const email1 = Email.create('test@example.com');
      const email2 = Email.create('test@example.com');
      const email3 = Email.create('other@example.com');

      expect(email1.equals(email2)).toBe(true);
      expect(email1.equals(email3)).toBe(false);
    });
  });

  describe('Invalid Email Validation (Defensive Failures)', () => {
    it('should throw DomainValidationError for empty string or whitespace', () => {
      expect(() => Email.create('')).toThrow(DomainValidationError);
      expect(() => Email.create('   ')).toThrow(DomainValidationError);
    });

    it('should throw DomainValidationError for email without @', () => {
      expect(() => Email.create('plainaddress')).toThrow(DomainValidationError);
    });

    it('should throw DomainValidationError for email without domain or username', () => {
      expect(() => Email.create('@missinguser.com')).toThrow(DomainValidationError);
      expect(() => Email.create('user@')).toThrow(DomainValidationError);
      expect(() => Email.create('user@.com')).toThrow(DomainValidationError);
    });
  });
});

