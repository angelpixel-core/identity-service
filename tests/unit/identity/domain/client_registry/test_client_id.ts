import { ClientId } from '../../../../../src/contexts/identity/domain/value_objects/client_id/value';
import { DomainValidationError } from '../../../../../src/contexts/identity/domain/exceptions/user/error';

describe('Value Object: ClientId', () => {
  describe('Valid ClientId Instantiation', () => {
    it('should create a ClientId instance for valid slug string', () => {
      const clientId = ClientId.create('portal-web');
      expect(clientId.getValue()).toBe('portal-web');
    });

    it('should trim whitespace and keep valid casing normalized', () => {
      const clientId = ClientId.create('  portal-app-123  ');
      expect(clientId.getValue()).toBe('portal-app-123');
    });

    it('should correctly evaluate value equality with equals()', () => {
      const id1 = ClientId.create('service-m2m');
      const id2 = ClientId.create('service-m2m');
      const id3 = ClientId.create('other-service');

      expect(id1.equals(id2)).toBe(true);
      expect(id1.equals(id3)).toBe(false);
    });
  });

  describe('Invalid ClientId Validation (Defensive Failures)', () => {
    it('should throw DomainValidationError for empty string or whitespace', () => {
      expect(() => ClientId.create('')).toThrow(DomainValidationError);
      expect(() => ClientId.create('   ')).toThrow(DomainValidationError);
    });

    it('should throw DomainValidationError if clientId contains invalid characters', () => {
      expect(() => ClientId.create('invalid client id with spaces')).toThrow(DomainValidationError);
      expect(() => ClientId.create('client@id!special#')).toThrow(DomainValidationError);
    });

    it('should throw DomainValidationError if clientId is shorter than 3 characters', () => {
      expect(() => ClientId.create('ab')).toThrow(DomainValidationError);
    });
  });
});