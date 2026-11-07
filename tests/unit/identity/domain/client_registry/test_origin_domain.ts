import { OriginDomain } from '../../../../../src/contexts/identity/domain/value_objects/origin_domain/value';
import { DomainValidationError } from '../../../../../src/contexts/identity/domain/exceptions/user/error';

describe('Value Object: OriginDomain', () => {
  describe('Valid OriginDomain Instantiation', () => {
    it('should create an OriginDomain instance for valid https origin', () => {
      const origin = OriginDomain.create('https://portal.angelsolutions.io');
      expect(origin.getValue()).toBe('https://portal.angelsolutions.io');
    });

    it('should create an OriginDomain for valid localhost with port', () => {
      const origin = OriginDomain.create('http://localhost:3000');
      expect(origin.getValue()).toBe('http://localhost:3000');
    });

    it('should normalize origin by trimming whitespace and removing trailing slash', () => {
      const origin = OriginDomain.create('  https://shop.angelsolutions.io/  ');
      expect(origin.getValue()).toBe('https://shop.angelsolutions.io');
    });

    it('should evaluate value equality correctly with equals()', () => {
      const o1 = OriginDomain.create('https://portal.angelsolutions.io');
      const o2 = OriginDomain.create('https://portal.angelsolutions.io/');
      const o3 = OriginDomain.create('https://other.angelsolutions.io');

      expect(o1.equals(o2)).toBe(true);
      expect(o1.equals(o3)).toBe(false);
    });
  });

  describe('Invalid OriginDomain Validation (Defensive Failures)', () => {
    it('should throw DomainValidationError for empty string or whitespace', () => {
      expect(() => OriginDomain.create('')).toThrow(DomainValidationError);
      expect(() => OriginDomain.create('   ')).toThrow(DomainValidationError);
    });

    it('should throw DomainValidationError for invalid URL format or missing protocol', () => {
      expect(() => OriginDomain.create('portal.angelsolutions.io')).toThrow(DomainValidationError);
      expect(() => OriginDomain.create('ftp://portal.angelsolutions.io')).toThrow(DomainValidationError);
      expect(() => OriginDomain.create('not-a-valid-domain')).toThrow(DomainValidationError);
    });

    it('should throw DomainValidationError if origin includes a path other than root', () => {
      expect(() => OriginDomain.create('https://portal.angelsolutions.io/app/home')).toThrow(DomainValidationError);
    });
  });
});