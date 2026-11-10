import util from 'util';
import { AuthorizationCode } from '../../../../../src/contexts/identity/domain/entities/authorization_code/entity';
import { ClientId } from '../../../../../src/contexts/identity/domain/value_objects/client_id/value';
import { TenantId } from '../../../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { DomainValidationError } from '../../../../../src/contexts/identity/domain/exceptions/user/error';

describe('Domain Entity: AuthorizationCode (Lifecycle & PKCE Invariants)', () => {
  const validVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const expectedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

  it('should successfully create an AuthorizationCode with default 60s TTL', () => {
    const authCode = AuthorizationCode.create({
      clientId: ClientId.create('client-web-portal'),
      userId: 'usr-12345',
      tenantId: TenantId.create('tenant-alpha'),
      redirectUri: 'https://portal.example.com/callback',
      scope: 'openid profile',
      codeChallenge: expectedChallenge,
      codeChallengeMethod: 'S256',
      nonce: 'nonce-sample-123',
    });

    expect(authCode.getCode()).toBeDefined();
    expect(authCode.getCode().length).toBeGreaterThan(20);
    expect(authCode.getClientId().getValue()).toBe('client-web-portal');
    expect(authCode.getUserId()).toBe('usr-12345');
    expect(authCode.getTenantId().getValue()).toBe('tenant-alpha');
    expect(authCode.getRedirectUri()).toBe('https://portal.example.com/callback');
    expect(authCode.getScope()).toBe('openid profile');
    expect(authCode.getCodeChallenge()).toBe(expectedChallenge);
    expect(authCode.getCodeChallengeMethod()).toBe('S256');
    expect(authCode.getNonce()).toBe('nonce-sample-123');
    expect(authCode.isConsumed()).toBe(false);
    expect(authCode.isExpired()).toBe(false);
  });

  it('should throw DomainValidationError if userId is empty', () => {
    expect(() =>
      AuthorizationCode.create({
        clientId: 'client-app',
        userId: '',
        tenantId: 'tenant-1',
        redirectUri: 'https://app.com/callback',
        scope: 'openid',
      })
    ).toThrow(DomainValidationError);
  });

  it('should throw DomainValidationError if redirectUri is empty', () => {
    expect(() =>
      AuthorizationCode.create({
        clientId: 'client-app',
        userId: 'user-1',
        tenantId: 'tenant-1',
        redirectUri: '   ',
        scope: 'openid',
      })
    ).toThrow(DomainValidationError);
  });

  it('should detect expired codes with custom clock', () => {
    const authCode = AuthorizationCode.create({
      clientId: 'client-app',
      userId: 'user-1',
      tenantId: 'tenant-1',
      redirectUri: 'https://app.com/callback',
      scope: 'openid',
      ttlSeconds: 10,
    });

    const pastDate = new Date(Date.now() + 5000);
    expect(authCode.isExpired(pastDate)).toBe(false);

    const futureDate = new Date(Date.now() + 15000);
    expect(authCode.isExpired(futureDate)).toBe(true);
  });

  it('should transition to consumed state upon consume() and reject double consumption', () => {
    const authCode = AuthorizationCode.create({
      clientId: 'client-app',
      userId: 'user-1',
      tenantId: 'tenant-1',
      redirectUri: 'https://app.com/callback',
      scope: 'openid',
    });

    expect(authCode.isConsumed()).toBe(false);
    authCode.consume();
    expect(authCode.isConsumed()).toBe(true);

    // Replay attempt must fail
    expect(() => authCode.consume()).toThrow(DomainValidationError);
    expect(() => authCode.consume()).toThrow(/already been consumed/);
  });

  it('should reject consume() when code is expired', () => {
    const authCode = AuthorizationCode.create({
      clientId: 'client-app',
      userId: 'user-1',
      tenantId: 'tenant-1',
      redirectUri: 'https://app.com/callback',
      scope: 'openid',
      ttlSeconds: 5,
    });

    const expiredClock = new Date(Date.now() + 10000);
    expect(() => authCode.consume(expiredClock)).toThrow(DomainValidationError);
    expect(() => authCode.consume(expiredClock)).toThrow(/has expired/);
  });

  it('should verify code_challenge with PKCE validator', () => {
    const authCode = AuthorizationCode.create({
      clientId: 'client-app',
      userId: 'user-1',
      tenantId: 'tenant-1',
      redirectUri: 'https://app.com/callback',
      scope: 'openid',
      codeChallenge: expectedChallenge,
      codeChallengeMethod: 'S256',
    });

    expect(authCode.verifyCodeChallenge(validVerifier)).toBe(true);
    expect(authCode.verifyCodeChallenge('wrong_verifier_string_at_least_43_characters_long_for_testing')).toBe(false);
  });

  it('should redact secret code in toString() and util.inspect()', () => {
    const authCode = AuthorizationCode.create({
      clientId: 'client-app',
      userId: 'user-1',
      tenantId: 'tenant-1',
      redirectUri: 'https://app.com/callback',
      scope: 'openid',
    });

    const rawCode = authCode.getCode();

    expect(authCode.toString()).toContain('code=[REDACTED]');
    expect(authCode.toString()).not.toContain(rawCode);

    const inspected = util.inspect(authCode);
    expect(inspected).toContain('[REDACTED]');
    expect(inspected).not.toContain(rawCode);
  });
});
