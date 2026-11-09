import { GetOpenIdConfigurationQueryHandler } from '../../../../../src/contexts/identity/application/queries/get_openid_configuration/handler';

describe('Application Query Handler: GetOpenIdConfigurationQueryHandler', () => {
  it('should return default issuer metadata when no query is provided', () => {
    const handler = new GetOpenIdConfigurationQueryHandler('https://auth.angelpixel.io');
    const result = handler.execute();

    expect(result.issuer).toBe('https://auth.angelpixel.io');
    expect(result.authorization_endpoint).toBe('https://auth.angelpixel.io/oauth2/authorize');
    expect(result.token_endpoint).toBe('https://auth.angelpixel.io/api/v1/oauth2/token');
    expect(result.jwks_uri).toBe('https://auth.angelpixel.io/.well-known/jwks.json');
    expect(result.userinfo_endpoint).toBe('https://auth.angelpixel.io/api/v1/auth/me');
    expect(result.response_types_supported).toContain('code');
    expect(result.id_token_signing_alg_values_supported).toContain('RS256');
    expect(result.code_challenge_methods_supported).toContain('S256');
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('should sanitize issuerBaseUrl by trimming trailing slashes, fragments and queries', () => {
    const handler = new GetOpenIdConfigurationQueryHandler();
    const result = handler.execute({
      issuerBaseUrl: '  https://custom-id.angelpixel.io///?param=value#section  ',
    });

    expect(result.issuer).toBe('https://custom-id.angelpixel.io');
    expect(result.jwks_uri).toBe('https://custom-id.angelpixel.io/.well-known/jwks.json');
  });

  it('should fallback to defaultIssuer when an invalid protocol or malformed URL is supplied', () => {
    const handler = new GetOpenIdConfigurationQueryHandler('https://safe-default.io');
    const result = handler.execute({
      issuerBaseUrl: 'javascript:alert(1)',
    });

    expect(result.issuer).toBe('https://safe-default.io');
  });

  it('should fallback to http://localhost:4000 when defaultIssuer is empty or malformed', () => {
    const handler = new GetOpenIdConfigurationQueryHandler('invalid-url-without-protocol');
    const result = handler.execute();

    expect(result.issuer).toBe('http://localhost:4000');
  });
});

