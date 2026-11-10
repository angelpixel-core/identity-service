import http from 'http';
import request from 'supertest';
import { Express } from 'express';
import { createApp } from '../../../interfaces/http/server';
import { InMemoryClientApplicationRepository } from '../../../src/contexts/identity/infrastructure/persistence/repositories/client_application/in_memory_client_repository';
import { InMemoryAuthorizationCodeRepository } from '../../../src/contexts/identity/infrastructure/persistence/repositories/authorization_code/in_memory_repository';
import { RsaKeyAdapter } from '../../../src/contexts/identity/infrastructure/security/rsa_key_adapter';

describe('Feature: OAuth2 Authorization Code Flow with PKCE (RFC 7636)', () => {
  let app: Express;
  let server: http.Server;
  let clientRepository: InMemoryClientApplicationRepository;
  let authCodeRepository: InMemoryAuthorizationCodeRepository;
  let asymmetricKeyProvider: RsaKeyAdapter;

  const validVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const expectedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

  beforeEach((done) => {
    clientRepository = new InMemoryClientApplicationRepository(true);
    authCodeRepository = new InMemoryAuthorizationCodeRepository();
    asymmetricKeyProvider = new RsaKeyAdapter();

    app = createApp({
      clientRepository,
      authCodeRepository,
      asymmetricKeyProvider,
    });
    server = http.createServer(app);
    server.listen(0, done);
  });

  afterEach((done) => {
    if (server) {
      server.closeAllConnections?.();
      server.close(done);
    } else {
      done();
    }
  });

  describe('Scenario: Successful authorization code generation with PKCE', () => {
    it('should issue authorization code and redirect to callback URI', async () => {
      // Given a registered public client "e-commerce-spa" with redirect URI "https://shop.local/callback"
      // When the client requests authorization with response_type "code", redirect_uri "https://shop.local/callback", code_challenge, and code_challenge_method "S256"
      const res = await request(server)
        .get('/oauth2/authorize')
        .query({
          response_type: 'code',
          client_id: 'e-commerce-spa',
          redirect_uri: 'https://shop.local/callback',
          scope: 'openid profile',
          code_challenge: expectedChallenge,
          code_challenge_method: 'S256',
          state: 'test-state-xyz',
        });

      // Then the system should issue an authorization code and redirect
      expect(res.status).toBe(302);
      expect(res.headers.location).toBeDefined();

      const locationUrl = new URL(res.headers.location as string);
      expect(locationUrl.origin).toBe('https://shop.local');
      expect(locationUrl.pathname).toBe('/callback');
      expect(locationUrl.searchParams.get('state')).toBe('test-state-xyz');
      expect(locationUrl.searchParams.get('code')).toBeTruthy();
    });
  });

  describe('Scenario: Successful token exchange with valid code_verifier', () => {
    it('should exchange code for RS256 access_token and id_token', async () => {
      // Given an issued authorization code for client "e-commerce-spa"
      const authRes = await request(server)
        .get('/oauth2/authorize')
        .query({
          response_type: 'code',
          client_id: 'e-commerce-spa',
          redirect_uri: 'https://shop.local/callback',
          scope: 'openid profile',
          code_challenge: expectedChallenge,
          code_challenge_method: 'S256',
        });

      const redirectUrl = new URL(authRes.headers.location as string);
      const code = redirectUrl.searchParams.get('code')!;
      expect(code).toBeTruthy();

      // When the client sends a POST request to "/oauth2/token" with valid code_verifier
      const tokenRes = await request(server)
        .post('/oauth2/token')
        .send({
          grant_type: 'authorization_code',
          client_id: 'e-commerce-spa',
          code: code,
          redirect_uri: 'https://shop.local/callback',
          code_verifier: validVerifier,
        });

      // Then the response status code should be 200 OK
      expect(tokenRes.status).toBe(200);
      expect(tokenRes.body.token_type).toBe('Bearer');
      expect(tokenRes.body.access_token).toBeDefined();
      expect(tokenRes.body.id_token).toBeDefined();
      expect(tokenRes.body.expires_in).toBe(900);
      expect(tokenRes.body.scope).toBe('openid profile');

      // Verify RS256 signature of id_token and access_token
      const idTokenDecoded = await asymmetricKeyProvider.verifyToken(tokenRes.body.id_token);
      expect(idTokenDecoded).toBeDefined();
      expect(idTokenDecoded.sub).toBeDefined();
      const accessTokenDecoded = await asymmetricKeyProvider.verifyToken(tokenRes.body.access_token);
      expect(accessTokenDecoded).toBeDefined();
    });
  });

  describe('Scenario: Reject token exchange with invalid code_verifier', () => {
    it('should reject exchange with HTTP 400 Bad Request and error invalid_grant', async () => {
      // Given an issued authorization code with code_challenge
      const authRes = await request(server)
        .get('/oauth2/authorize')
        .query({
          response_type: 'code',
          client_id: 'e-commerce-spa',
          redirect_uri: 'https://shop.local/callback',
          scope: 'openid profile',
          code_challenge: expectedChallenge,
          code_challenge_method: 'S256',
        });

      const redirectUrl = new URL(authRes.headers.location as string);
      const code = redirectUrl.searchParams.get('code')!;

      // When the client presents an incorrect code_verifier (at least 43 chars)
      const tokenRes = await request(server)
        .post('/oauth2/token')
        .send({
          grant_type: 'authorization_code',
          client_id: 'e-commerce-spa',
          code: code,
          redirect_uri: 'https://shop.local/callback',
          code_verifier: 'wrong_verifier_string_at_least_43_characters_long_for_testing',
        });

      // Then the system should reject the exchange with HTTP 400 Bad Request and invalid_grant
      expect(tokenRes.status).toBe(400);
      expect(tokenRes.body.error).toBe('invalid_grant');
    });
  });

  describe('Scenario: Reject token exchange when authorization code is reused', () => {
    it('should reject exchange when authorization code is presented a second time', async () => {
      // Given an authorization code that has already been consumed
      const authRes = await request(server)
        .get('/oauth2/authorize')
        .query({
          response_type: 'code',
          client_id: 'e-commerce-spa',
          redirect_uri: 'https://shop.local/callback',
          scope: 'openid',
          code_challenge: expectedChallenge,
          code_challenge_method: 'S256',
        });

      const redirectUrl = new URL(authRes.headers.location as string);
      const code = redirectUrl.searchParams.get('code')!;

      // First exchange: Success
      const firstExchange = await request(server)
        .post('/oauth2/token')
        .send({
          grant_type: 'authorization_code',
          client_id: 'e-commerce-spa',
          code: code,
          redirect_uri: 'https://shop.local/callback',
          code_verifier: validVerifier,
        });
      expect(firstExchange.status).toBe(200);

      // When the client attempts to exchange the consumed code again
      const secondExchange = await request(server)
        .post('/oauth2/token')
        .send({
          grant_type: 'authorization_code',
          client_id: 'e-commerce-spa',
          code: code,
          redirect_uri: 'https://shop.local/callback',
          code_verifier: validVerifier,
        });

      // Then the system should reject the replay with HTTP 400 Bad Request and invalid_grant
      expect(secondExchange.status).toBe(400);
      expect(secondExchange.body.error).toBe('invalid_grant');
    });
  });

  describe('Scenario: Reject authorization request for public client without code_challenge', () => {
    it('should reject public client authorization request without code_challenge', async () => {
      // Given a registered public client "e-commerce-spa"
      // When the client requests authorization without code_challenge
      const res = await request(server)
        .get('/oauth2/authorize')
        .query({
          response_type: 'code',
          client_id: 'e-commerce-spa',
          redirect_uri: 'https://shop.local/callback',
        });

      // Then the system should reject the request with HTTP 400 Bad Request and invalid_request
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_request');
    });
  });
});