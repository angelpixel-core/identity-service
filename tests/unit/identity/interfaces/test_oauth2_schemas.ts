import {
  OAuth2TokenRequestSchema,
  validateOAuth2TokenRequest,
} from '../../../../interfaces/http/rest/v1/oauth2/schemas';
import { OAuth2AuthenticationError } from '../../../../src/contexts/identity/domain/exceptions/oauth2/error';

describe('HTTP Interface Schemas: OAuth2TokenRequestSchema & validateOAuth2TokenRequest', () => {
  it('should validate valid client_credentials parameters successfully with Zod schema', () => {
    const validParams = {
      grantType: 'client_credentials',
      clientId: 'order-service',
      clientSecret: 'SuperSecureSecretKeyForTestingClientCredentials_2026!',
      scope: 'identity:read',
      ip: '127.0.0.1',
    };

    const parseResult = OAuth2TokenRequestSchema.safeParse(validParams);
    expect(parseResult.success).toBe(true);

    const validated = validateOAuth2TokenRequest(validParams);
    expect(validated.grantType).toBe('client_credentials');
    expect(validated.clientId).toBe('order-service');
    expect(validated.scope).toBe('identity:read');
    expect(validated.ip).toBe('127.0.0.1');
  });

  it('should throw OAuth2AuthenticationError (invalid_request, 400) when grantType is missing or empty', () => {
    expect(() =>
      validateOAuth2TokenRequest({
        clientId: 'order-service',
      })
    ).toThrow(OAuth2AuthenticationError);

    try {
      validateOAuth2TokenRequest({ clientId: 'order-service' });
    } catch (err) {
      expect(err).toMatchObject({
        errorCode: 'invalid_request',
        statusCode: 400,
      });
    }
  });

  it('should throw OAuth2AuthenticationError (invalid_request, 400) when clientId is missing or empty', () => {
    try {
      validateOAuth2TokenRequest({
        grantType: 'client_credentials',
        clientId: '   ',
      });
    } catch (err) {
      expect(err).toMatchObject({
        errorCode: 'invalid_request',
        statusCode: 400,
      });
    }
  });

  it('should throw OAuth2AuthenticationError (unsupported_grant_type, 400) when grantType is not client_credentials', () => {
    try {
      validateOAuth2TokenRequest({
        grantType: 'authorization_code',
        clientId: 'order-service',
      });
    } catch (err) {
      expect(err).toMatchObject({
        errorCode: 'unsupported_grant_type',
        statusCode: 400,
      });
    }
  });
});