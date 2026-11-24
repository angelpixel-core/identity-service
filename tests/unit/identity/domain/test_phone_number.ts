import { PhoneNumber } from '../../../../src/contexts/identity/domain/value_objects/phone_number/value';
import { DomainValidationError } from '../../../../src/contexts/identity/domain/exceptions/user/error';

describe('Unit: US-32 PhoneNumber Value Object (E.164)', () => {
  it('should normalize spaces, hyphens and parentheses before validating E.164', () => {
    const phone = PhoneNumber.create(' +54 9 (11) 1234-5678 ');
    expect(phone.getValue()).toBe('+5491112345678');
    expect(phone.equals(PhoneNumber.create('+5491112345678'))).toBe(true);
  });

  it('should reject phone numbers without leading + or starting with +0 or too short', () => {
    expect(() => PhoneNumber.create('5491112345678')).toThrow(DomainValidationError);
    expect(() => PhoneNumber.create('+01112345678')).toThrow(DomainValidationError);
    expect(() => PhoneNumber.create('+12345')).toThrow(DomainValidationError);
    expect(() => PhoneNumber.create('abc')).toThrow(DomainValidationError);
    expect(() => PhoneNumber.create('')).toThrow(DomainValidationError);
  });
});
