import { KeyId } from '../../../../../src/contexts/identity/domain/value_objects/crypto/key_id';
import { DomainValidationError } from '../../../../../src/contexts/identity/domain/exceptions/user/error';

describe('Value Object: KeyId (RFC 7517 Key Identifier)', () => {
  it('should successfully create a valid KeyId and guarantee immutability', () => {
    const kid = KeyId.create('key-2026-prod');

    expect(kid.getValue()).toBe('key-2026-prod');
    expect(kid.toString()).toBe('key-2026-prod');
    expect(Object.isFrozen(kid)).toBe(true);
  });

  it('should trim surrounding whitespace from input string', () => {
    const kid = KeyId.create('  key-trimmed-id  ');
    expect(kid.getValue()).toBe('key-trimmed-id');
  });

  it('should allow valid characters: alphanumeric, hyphens, underscores, dots, and colons', () => {
    const validKids = [
      'key-123',
      'key_456',
      'key.789',
      'urn:ietf:params:oauth:jwk-set',
      'abc:def.ghi-123_456',
    ];

    for (const valid of validKids) {
      expect(KeyId.create(valid).getValue()).toBe(valid);
    }
  });

  it('should throw DomainValidationError if rawKeyId is null, undefined, empty, or only whitespace', () => {
    expect(() => KeyId.create(null as any)).toThrow(DomainValidationError);
    expect(() => KeyId.create(undefined as any)).toThrow(DomainValidationError);
    expect(() => KeyId.create('')).toThrow(DomainValidationError);
    expect(() => KeyId.create('   ')).toThrow(DomainValidationError);
  });

  it('should throw DomainValidationError if KeyId is too short (< 3 characters)', () => {
    expect(() => KeyId.create('k1')).toThrow(DomainValidationError);
  });

  it('should throw DomainValidationError if KeyId is too long (> 128 characters)', () => {
    const tooLong = 'k'.repeat(129);
    expect(() => KeyId.create(tooLong)).toThrow(DomainValidationError);
  });

  it('should throw DomainValidationError if KeyId contains invalid characters', () => {
    const invalidKids = ['key@123', 'key#456', 'key$789', 'key/path', 'key with space'];

    for (const invalid of invalidKids) {
      expect(() => KeyId.create(invalid)).toThrow(DomainValidationError);
    }
  });

  it('should correctly evaluate value equality with equals()', () => {
    const kid1 = KeyId.create('key-alpha-1');
    const kid2 = KeyId.create('key-alpha-1');
    const kid3 = KeyId.create('key-beta-2');

    expect(kid1.equals(kid2)).toBe(true);
    expect(kid1.equals(kid3)).toBe(false);
    expect(kid1.equals(null as any)).toBe(false);
    expect(kid1.equals({ getValue: () => 'key-alpha-1' } as any)).toBe(false);
  });
});

