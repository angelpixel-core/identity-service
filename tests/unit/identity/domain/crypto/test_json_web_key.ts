import { JsonWebKeyVO } from '../../../../../src/contexts/identity/domain/value_objects/crypto/json_web_key';
import { KeyId } from '../../../../../src/contexts/identity/domain/value_objects/crypto/key_id';
import { DomainValidationError } from '../../../../../src/contexts/identity/domain/exceptions/user/error';

describe('Value Object: JsonWebKeyVO (RFC 7517 Public Key Structure & Invariants)', () => {
  const validProps = {
    kty: 'RSA' as const,
    use: 'sig' as const,
    alg: 'RS256' as const,
    kid: 'key-test-2026',
    n: 'sX0n...mock-base64url-modulus...',
    e: 'AQAB',
  };

  it('should successfully create a valid JsonWebKeyVO with string kid and guarantee immutability', () => {
    const jwk = JsonWebKeyVO.create(validProps);

    expect(jwk.getKid().getValue()).toBe('key-test-2026');
    expect(jwk.getModulus()).toBe('sX0n...mock-base64url-modulus...');
    expect(jwk.getExponent()).toBe('AQAB');
    expect(Object.isFrozen(jwk)).toBe(true);

    const dto = jwk.toDto();
    expect(dto.kty).toBe('RSA');
    expect(dto.use).toBe('sig');
    expect(dto.alg).toBe('RS256');
    expect(dto.kid).toBe('key-test-2026');
  });

  it('should accept an existing KeyId instance as kid', () => {
    const keyId = KeyId.create('key-instance-999');
    const jwk = JsonWebKeyVO.create({ ...validProps, kid: keyId });

    expect(jwk.getKid().equals(keyId)).toBe(true);
  });

  it('CRITICAL SECURITY: should throw DomainValidationError if any private key parameter is passed', () => {
    const forbiddenParams = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'];

    for (const param of forbiddenParams) {
      expect(() =>
        JsonWebKeyVO.create({
          ...validProps,
          [param]: 'secret-private-key-component',
        })
      ).toThrow(DomainValidationError);
    }
  });

  it('should throw DomainValidationError if kty is not RSA', () => {
    expect(() =>
      JsonWebKeyVO.create({
        ...validProps,
        kty: 'EC' as any,
      })
    ).toThrow(DomainValidationError);
  });

  it('should throw DomainValidationError if use is not sig', () => {
    expect(() =>
      JsonWebKeyVO.create({
        ...validProps,
        use: 'enc' as any,
      })
    ).toThrow(DomainValidationError);
  });

  it('should throw DomainValidationError if alg is not RS256', () => {
    expect(() =>
      JsonWebKeyVO.create({
        ...validProps,
        alg: 'HS256' as any,
      })
    ).toThrow(DomainValidationError);
  });

  it('should throw DomainValidationError if modulus n is empty or whitespace', () => {
    expect(() =>
      JsonWebKeyVO.create({
        ...validProps,
        n: '',
      })
    ).toThrow(DomainValidationError);

    expect(() =>
      JsonWebKeyVO.create({
        ...validProps,
        n: '   ',
      })
    ).toThrow(DomainValidationError);
  });

  it('should throw DomainValidationError if exponent e is empty or whitespace', () => {
    expect(() =>
      JsonWebKeyVO.create({
        ...validProps,
        e: '',
      })
    ).toThrow(DomainValidationError);
  });

  it('should evaluate equality with equals() correctly', () => {
    const jwk1 = JsonWebKeyVO.create(validProps);
    const jwk2 = JsonWebKeyVO.create(validProps);
    const jwk3 = JsonWebKeyVO.create({ ...validProps, kid: 'key-other-id' });

    expect(jwk1.equals(jwk2)).toBe(true);
    expect(jwk1.equals(jwk3)).toBe(false);
    expect(jwk1.equals(null)).toBe(false);
  });
});

