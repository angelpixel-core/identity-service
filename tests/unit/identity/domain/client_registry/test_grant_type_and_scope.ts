import { GrantType } from '../../../../../src/contexts/identity/domain/value_objects/grant_type/value';
import { Scope } from '../../../../../src/contexts/identity/domain/value_objects/scope/value';
import { ClientApplication } from '../../../../../src/contexts/identity/domain/entities/client_application/aggregate';
import { ClientId } from '../../../../../src/contexts/identity/domain/value_objects/client_id/value';
import { OriginDomain } from '../../../../../src/contexts/identity/domain/value_objects/origin_domain/value';
import { DomainValidationError } from '../../../../../src/contexts/identity/domain/exceptions/user/error';

describe('Value Objects: GrantType & Scope', () => {
  describe('GrantType Value Object', () => {
    it('should create valid GrantType instances for supported OAuth2 flows', () => {
      const authCode = GrantType.create('authorization_code');
      const refresh = GrantType.create('  REFRESH_TOKEN  ');
      const m2m = GrantType.create('client_credentials');

      expect(authCode.getValue()).toBe('authorization_code');
      expect(refresh.getValue()).toBe('refresh_token');
      expect(m2m.getValue()).toBe('client_credentials');
      expect(authCode.equals(GrantType.create('authorization_code'))).toBe(true);
      expect(authCode.equals(m2m)).toBe(false);
    });

    it('should throw DomainValidationError for unsupported or empty grant types', () => {
      expect(() => GrantType.create('')).toThrow(DomainValidationError);
      expect(() => GrantType.create('   ')).toThrow(DomainValidationError);
      expect(() => GrantType.create('implicit')).toThrow(DomainValidationError);
      expect(() => GrantType.create('password')).toThrow(DomainValidationError);
    });
  });

  describe('Scope Value Object', () => {
    it('should create valid Scope instances for OIDC and custom API scopes', () => {
      const openid = Scope.create('openid');
      const profile = Scope.create('  PROFILE  ');
      const custom = Scope.create('identity:read');

      expect(openid.getValue()).toBe('openid');
      expect(profile.getValue()).toBe('profile');
      expect(custom.getValue()).toBe('identity:read');
      expect(custom.equals(Scope.create('identity:read'))).toBe(true);
      expect(custom.equals(openid)).toBe(false);
    });

    it('should throw DomainValidationError for invalid or empty scopes', () => {
      expect(() => Scope.create('')).toThrow(DomainValidationError);
      expect(() => Scope.create('a')).toThrow(DomainValidationError);
      expect(() => Scope.create('invalid scope with spaces')).toThrow(DomainValidationError);
      expect(() => Scope.create('scope$invalid#')).toThrow(DomainValidationError);
    });
  });

  describe('ClientApplication GrantType and Scope Invariants', () => {
    it('should throw DomainValidationError when a public client requests client_credentials grant', () => {
      expect(() =>
        ClientApplication.create({
          id: 'client-pub-invalid',
          clientId: ClientId.create('spa-frontend'),
          clientName: 'Invalid Public Client',
          clientType: 'public',
          allowedOrigins: [OriginDomain.create('https://app.angelsolutions.io')],
          redirectUris: ['https://app.angelsolutions.io/callback'],
          allowedGrantTypes: ['authorization_code', 'client_credentials'],
          scopes: ['openid'],
        })
      ).toThrow(DomainValidationError);
    });

    it('should evaluate hasGrantType() and hasScope() accurately', () => {
      const client = ClientApplication.create({
        id: 'client-10',
        clientId: ClientId.create('portal-web'),
        clientName: 'Portal Web App',
        clientType: 'public',
        allowedOrigins: [OriginDomain.create('https://portal.angelsolutions.io')],
        redirectUris: ['https://portal.angelsolutions.io/callback'],
        allowedGrantTypes: [GrantType.create('authorization_code'), 'refresh_token'],
        scopes: [Scope.create('openid'), 'profile', 'identity:read'],
      });

      expect(client.hasGrantType('authorization_code')).toBe(true);
      expect(client.hasGrantType('refresh_token')).toBe(true);
      expect(client.hasGrantType('client_credentials')).toBe(false);
      expect(client.hasGrantType('invalid_grant_type')).toBe(false);

      expect(client.hasScope('openid')).toBe(true);
      expect(client.hasScope('identity:read')).toBe(true);
      expect(client.hasScope('identity:admin')).toBe(false);
      expect(client.getAllowedGrantTypeVOs()).toHaveLength(2);
      expect(client.getScopeVOs()).toHaveLength(3);
    });
  });
});

