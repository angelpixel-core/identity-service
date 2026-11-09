import http from 'http';
import request from 'supertest';
import { Express } from 'express';
import { createApp } from '../../../interfaces/http/server';

describe('Feature: Cryptographic Keypair Management, JWKS and OpenID Discovery Endpoints', () => {
  let app: Express;
  let server: http.Server;

  beforeEach((done) => {
    app = createApp();
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

  describe('Scenario: Retrieve OpenID Connect Discovery metadata', () => {
    it('should return 200 OK with complete OpenID configuration document conforming to RFC 8414', async () => {
      // When a client sends a GET request to "/.well-known/openid-configuration"
      const res = await request(server).get('/.well-known/openid-configuration');

      // Then the response status code should be 200
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);

      // And the response body should contain "issuer" matching the service public URL
      expect(res.body).toHaveProperty('issuer');
      expect(typeof res.body.issuer).toBe('string');
      expect(res.body.issuer.length).toBeGreaterThan(0);

      // And the response body should contain "jwks_uri" ending in "/.well-known/jwks.json"
      expect(res.body).toHaveProperty('jwks_uri');
      expect(res.body.jwks_uri).toMatch(/\/\.well-known\/jwks\.json$/);

      // And the response body should indicate support for "RS256" in "id_token_signing_alg_values_supported"
      expect(res.body).toHaveProperty('id_token_signing_alg_values_supported');
      expect(res.body.id_token_signing_alg_values_supported).toContain('RS256');

      // And the response body should list supported response types including "code"
      expect(res.body).toHaveProperty('response_types_supported');
      expect(res.body.response_types_supported).toContain('code');

      // And the response body should list supported token endpoint auth methods
      expect(res.body).toHaveProperty('token_endpoint_auth_methods_supported');
      expect(res.body.token_endpoint_auth_methods_supported).toContain('client_secret_post');
      expect(res.body.token_endpoint_auth_methods_supported).toContain('client_secret_basic');

      // Additional standard endpoints
      expect(res.body).toHaveProperty('authorization_endpoint');
      expect(res.body).toHaveProperty('token_endpoint');
      expect(res.body).toHaveProperty('code_challenge_methods_supported');
      expect(res.body.code_challenge_methods_supported).toContain('S256');
    });
  });

  describe('Scenario: Retrieve valid JSON Web Key Set (JWKS)', () => {
    it('should return 200 OK with RFC 7517 compliant keys array containing RS256 public key parameters', async () => {
      // When a client sends a GET request to "/.well-known/jwks.json"
      const res = await request(server).get('/.well-known/jwks.json');

      // Then the response status code should be 200
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);

      // And the response body should contain a "keys" array with at least one active key
      expect(res.body).toHaveProperty('keys');
      expect(Array.isArray(res.body.keys)).toBe(true);
      expect(res.body.keys.length).toBeGreaterThanOrEqual(1);

      // And each key in "keys" must contain "kty": "RSA", "alg": "RS256", "use": "sig", "n", "e", and "kid"
      for (const key of res.body.keys) {
        expect(key.kty).toBe('RSA');
        expect(key.alg).toBe('RS256');
        expect(key.use).toBe('sig');
        expect(typeof key.kid).toBe('string');
        expect(key.kid.length).toBeGreaterThan(0);
        expect(typeof key.n).toBe('string');
        expect(key.n.length).toBeGreaterThan(0);
        expect(typeof key.e).toBe('string');
        expect(key.e.length).toBeGreaterThan(0);
        // Exponent e in standard RSA is typically AQAB (65537)
        expect(key.e).toBe('AQAB');
      }
    });
  });
});
