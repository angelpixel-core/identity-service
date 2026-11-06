import { ClientApplication } from '../../../../../src/contexts/identity/domain/entities/client_application/aggregate';
import { ClientId } from '../../../../../src/contexts/identity/domain/value_objects/client_id/value';
import { OriginDomain } from '../../../../../src/contexts/identity/domain/value_objects/origin_domain/value';
import { DomainValidationError } from '../../../../../src/contexts/identity/domain/exceptions/user/error';

describe('Aggregate Root: ClientApplication', () => {
  const validClientId = ClientId.create('portal-web');
  const validOrigin = OriginDomain.create('https://portal.angelsolutions.io');

  describe('Creation of Public Client Application', () => {
    it('should successfully create a public client without clientSecretHash', () => {
      const client = ClientApplication.create({
        id: 'client-1',
        clientId: validClientId,
        clientName: 'AngelSolutions Web Portal',
        clientType: 'public',
        allowedOrigins: [validOrigin],
        redirectUris: ['https://portal.angelsolutions.io/callback'],
        allowedGrantTypes: ['authorization_code'],
        scopes: ['openid', 'profile'],
        isActive: true,
      });

      expect(client.getId()).toBe('client-1');
      expect(client.getClientId().getValue()).toBe('portal-web');
      expect(client.getClientType()).toBe('public');
      expect(client.getClientSecretHash()).toBeNull();
      expect(client.isActive()).toBe(true);
      expect(client.getAllowedOrigins()).toHaveLength(1);
    });

    it('should throw DomainValidationError if public client provides a clientSecretHash', () => {
      expect(() =>
        ClientApplication.create({
          id: 'client-1',
          clientId: validClientId,
          clientName: 'Public SPA with secret',
          clientType: 'public',
          clientSecretHash: 'forbidden-secret-hash',
          allowedOrigins: [validOrigin],
          redirectUris: ['https://portal.angelsolutions.io/callback'],
          allowedGrantTypes: ['authorization_code'],
          scopes: ['openid'],
          isActive: true,
        })
      ).toThrow(DomainValidationError);
    });
  });

  describe('Creation of Confidential Client Application', () => {
    it('should successfully create a confidential client with clientSecretHash', () => {
      const client = ClientApplication.create({
        id: 'client-2',
        clientId: ClientId.create('backend-m2m'),
        clientName: 'Order Processing Service',
        clientType: 'confidential',
        clientSecretHash: '$2b$10$hashedsecretvalue12345678901234567890',
        allowedOrigins: [OriginDomain.create('https://api.angelsolutions.io')],
        redirectUris: ['https://api.angelsolutions.io/oauth2/callback'],
        allowedGrantTypes: ['client_credentials'],
        scopes: ['orders:read', 'orders:write'],
        isActive: true,
      });

      expect(client.getClientType()).toBe('confidential');
      expect(client.getClientSecretHash()).toBe('$2b$10$hashedsecretvalue12345678901234567890');
    });

    it('should throw DomainValidationError if confidential client is missing clientSecretHash', () => {
      expect(() =>
        ClientApplication.create({
          id: 'client-2',
          clientId: ClientId.create('backend-m2m'),
          clientName: 'Order Processing Service',
          clientType: 'confidential',
          allowedOrigins: [validOrigin],
          redirectUris: ['https://api.angelsolutions.io/callback'],
          allowedGrantTypes: ['client_credentials'],
          scopes: ['orders:read'],
          isActive: true,
        })
      ).toThrow(DomainValidationError);
    });
  });

  describe('Business Invariants and Methods', () => {
    it('should throw DomainValidationError if allowedOrigins is empty for a public client', () => {
      expect(() =>
        ClientApplication.create({
          id: 'client-3',
          clientId: validClientId,
          clientName: 'Web Portal with no origins',
          clientType: 'public',
          allowedOrigins: [],
          redirectUris: ['https://portal.angelsolutions.io/callback'],
          allowedGrantTypes: ['authorization_code'],
          scopes: ['openid'],
          isActive: true,
        })
      ).toThrow(DomainValidationError);
    });

    it('should correctly check if an origin is allowed with isOriginAllowed()', () => {
      const client = ClientApplication.create({
        id: 'client-1',
        clientId: validClientId,
        clientName: 'AngelSolutions Web Portal',
        clientType: 'public',
        allowedOrigins: [
          validOrigin,
          OriginDomain.create('https://beta.angelsolutions.io'),
        ],
        redirectUris: ['https://portal.angelsolutions.io/callback'],
        allowedGrantTypes: ['authorization_code'],
        scopes: ['openid'],
        isActive: true,
      });

      expect(client.isOriginAllowed('https://portal.angelsolutions.io')).toBe(true);
      expect(client.isOriginAllowed('https://beta.angelsolutions.io/')).toBe(true);
      expect(client.isOriginAllowed('https://malicious-site.com')).toBe(false);
    });

    it('should allow activating and deactivating client application', () => {
      const client = ClientApplication.create({
        id: 'client-1',
        clientId: validClientId,
        clientName: 'AngelSolutions Web Portal',
        clientType: 'public',
        allowedOrigins: [validOrigin],
        redirectUris: ['https://portal.angelsolutions.io/callback'],
        allowedGrantTypes: ['authorization_code'],
        scopes: ['openid'],
        isActive: true,
      });

      expect(client.isActive()).toBe(true);
      client.deactivate();
      expect(client.isActive()).toBe(false);
      client.activate();
      expect(client.isActive()).toBe(true);
    });
  });
});