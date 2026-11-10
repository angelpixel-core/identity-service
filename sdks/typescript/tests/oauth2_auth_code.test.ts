import { IdentityServiceClient } from '../src/client';
import { HttpTransport } from '../src/types/common';
import { OAuth2TokenResponse } from '../src/types/oauth2';

describe('SDK Resource: OAuth2Resource (Authorization Code Flow with PKCE - US-08)', () => {
  let mockTransport: HttpTransport;
  let getMock: jest.Mock;
  let postMock: jest.Mock;

  beforeEach(() => {
    getMock = jest.fn();
    postMock = jest.fn();
    mockTransport = {
      get: getMock,
      post: postMock,
    };
  });

  describe('buildAuthorizationUrl', () => {
    it('should build a complete authorization URL with PKCE parameters', () => {
      const client = new IdentityServiceClient({ transport: mockTransport });

      const urlString = client.oauth2.buildAuthorizationUrl({
        baseUrl: 'https://auth.company.local',
        clientId: 'e-commerce-spa',
        redirectUri: 'https://shop.local/callback',
        scope: 'openid profile email',
        state: 'session-state-1234',
        codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        codeChallengeMethod: 'S256',
        nonce: 'nonce-xyz',
      });

      const parsedUrl = new URL(urlString);
      expect(parsedUrl.origin).toBe('https://auth.company.local');
      expect(parsedUrl.pathname).toBe('/oauth2/authorize');
      expect(parsedUrl.searchParams.get('response_type')).toBe('code');
      expect(parsedUrl.searchParams.get('client_id')).toBe('e-commerce-spa');
      expect(parsedUrl.searchParams.get('redirect_uri')).toBe('https://shop.local/callback');
      expect(parsedUrl.searchParams.get('scope')).toBe('openid profile email');
      expect(parsedUrl.searchParams.get('state')).toBe('session-state-1234');
      expect(parsedUrl.searchParams.get('code_challenge')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
      expect(parsedUrl.searchParams.get('code_challenge_method')).toBe('S256');
      expect(parsedUrl.searchParams.get('nonce')).toBe('nonce-xyz');
    });

    it('should return relative path when baseUrl is omitted', () => {
      const client = new IdentityServiceClient({ transport: mockTransport });

      const relativeUrl = client.oauth2.buildAuthorizationUrl({
        clientId: 'portal-app',
        redirectUri: 'https://portal.local/callback',
      });

      expect(relativeUrl).toMatch(/^\/oauth2\/authorize\?response_type=code&client_id=portal-app/);
    });
  });

  describe('exchangeAuthorizationCode', () => {
    it('should exchange code for RS256 access_token and id_token via /oauth2/token', async () => {
      const mockTokenResponse: OAuth2TokenResponse = {
        access_token: 'signed.jwt.access_token',
        token_type: 'Bearer',
        expires_in: 900,
        scope: 'openid profile',
        id_token: 'signed.rs256.id_token',
      };

      postMock.mockResolvedValueOnce({
        status: 200,
        data: mockTokenResponse,
      });

      const client = new IdentityServiceClient({ transport: mockTransport });

      const result = await client.oauth2.exchangeAuthorizationCode({
        clientId: 'e-commerce-spa',
        code: 'splat-auth-code-12345',
        redirectUri: 'https://shop.local/callback',
        codeVerifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      });

      expect(postMock).toHaveBeenCalledWith(
        '/oauth2/token',
        {
          grant_type: 'authorization_code',
          client_id: 'e-commerce-spa',
          code: 'splat-auth-code-12345',
          redirect_uri: 'https://shop.local/callback',
          code_verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
        },
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );

      expect(result.access_token).toBe('signed.jwt.access_token');
      expect(result.id_token).toBe('signed.rs256.id_token');
      expect(result.expires_in).toBe(900);
      expect(result.token_type).toBe('Bearer');
    });

    it('should include clientSecret when exchanging code for confidential clients', async () => {
      postMock.mockResolvedValueOnce({
        status: 200,
        data: {
          access_token: 'jwt.token',
          token_type: 'Bearer',
          expires_in: 900,
        },
      });

      const client = new IdentityServiceClient({ transport: mockTransport });

      await client.oauth2.exchangeAuthorizationCode({
        clientId: 'portal-admin',
        clientSecret: 'Secret123!',
        code: 'code-99',
        redirectUri: 'https://admin.portal.local/callback',
        codeVerifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      });

      expect(postMock).toHaveBeenCalledWith(
        '/oauth2/token',
        expect.objectContaining({
          client_id: 'portal-admin',
          client_secret: 'Secret123!',
        }),
        expect.anything()
      );
    });
  });
});

