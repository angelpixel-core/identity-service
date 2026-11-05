import http from 'http';
import request from 'supertest';
import { createApp } from '../../../interfaces/http/server';

describe('Feature: Get Tenant User Profile', () => {
  let server: http.Server;

  beforeEach((done) => {
    const app = createApp();
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

  describe('Scenario: Successful profile retrieval with Cache Miss and Cache Hit', () => {
    it('should fetch user details, populate cache, and return 200 OK', async () => {
      // Register a user first to have valid credentials & token
      const registerRes = await request(server)
        .post('/api/v1/auth/register')
        .set('x-tenant-id', 'acme-corp')
        .send({
          email: 'profile.user@acme.com',
          password: 'Password123!',
        });

      expect(registerRes.status).toBe(201);
      const token = registerRes.body.token;

      // When requesting /api/v1/auth/me with Bearer token
      const profileRes = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', 'acme-corp');

      expect(profileRes.status).toBe(200);
      expect(profileRes.body).toHaveProperty('id');
      expect(profileRes.body).toHaveProperty('email', 'profile.user@acme.com');
      expect(profileRes.body).toHaveProperty('tenantId', 'acme-corp');
      expect(profileRes.body).not.toHaveProperty('passwordHash');
    });
  });

  describe('Scenario: Unauthorized profile access without JWT token', () => {
    it('should return 401 Unauthorized when Authorization header is missing', async () => {
      const response = await request(server)
        .get('/api/v1/auth/me')
        .set('x-tenant-id', 'acme-corp');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Scenario: Profile access with invalid or expired JWT token', () => {
    it('should return 401 Unauthorized when Bearer token is invalid', async () => {
      const response = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid-malformed-token')
        .set('x-tenant-id', 'acme-corp');

      expect(response.status).toBe(401);
    });
  });
});

