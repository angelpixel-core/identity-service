import { IdentityServiceClient } from '../src/client';
import { HttpTransport } from '../src/types/common';
import { OAuth2TokenResponse, RevokeTokenResponse } from '../src/types/oauth2';

describe('SDK Resource: OAuth2Resource (Refresh Token Rotation & Revocation - US-09)', () => {
  let mockTransport: HttpTransport;
  let postMock: jest.Mock;

  beforeEach(() => {
    postMock = jest.fn();
    mockTransport = {
      get: jest.fn(),
      post: postMock,
    };
  });

  describe('refreshToken', () => {
    it('should rotate token via POST /oauth2/refresh with grant_type=refresh_token', async () => {
      const client = new IdentityServiceClient({ transport: mockTransport });

      const mockResponse: OAuth2TokenResponse = {
        access_token: 'new-jwt-access-token',
        token_type: 'Bearer',
        expires_in: 900,
        id_token: 'new-id-token',
        refresh_token: 'new-rotated-refresh-token',
      };

      postMock.mockResolvedValueOnce({
        status: 200,
        data: mockResponse,
        headers: {},
      });

      const result = await client.oauth2.refreshToken({
        refreshToken: 'current-plain-rt-token',
        clientId: 'e-commerce-spa',
      });

      expect(postMock).toHaveBeenCalledTimes(1);
      expect(postMock).toHaveBeenCalledWith(
        '/oauth2/refresh',
        {
          grant_type: 'refresh_token',
          refresh_token: 'current-plain-rt-token',
          client_id: 'e-commerce-spa',
        },
        undefined
      );
      expect(result.access_token).toBe('new-jwt-access-token');
      expect(result.refresh_token).toBe('new-rotated-refresh-token');
    });
  });

  describe('revokeToken', () => {
    it('should revoke token and session via POST /oauth2/revoke', async () => {
      const client = new IdentityServiceClient({ transport: mockTransport });

      const mockResponse: RevokeTokenResponse = {
        message: 'Session revoked successfully',
      };

      postMock.mockResolvedValueOnce({
        status: 200,
        data: mockResponse,
        headers: {},
      });

      const result = await client.oauth2.revokeToken({
        refreshToken: 'token-to-revoke-xyz',
        reason: 'user_logout',
      });

      expect(postMock).toHaveBeenCalledTimes(1);
      expect(postMock).toHaveBeenCalledWith(
        '/oauth2/revoke',
        {
          refresh_token: 'token-to-revoke-xyz',
          reason: 'user_logout',
        },
        undefined
      );
      expect(result.message).toBe('Session revoked successfully');
    });
  });
});

