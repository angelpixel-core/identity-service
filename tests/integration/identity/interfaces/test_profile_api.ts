import http from 'http';
import request from 'supertest';
import { createApp } from '../../../../interfaces/http/server';

describe('Integration API: GET /api/v1/auth/me', () => {
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

  describe('Happy Path: Authenticated Profile Retrieval (200 OK)', () => {
    it('should return sanitized user profile for authenticated tenant user', async () => {
      // 1. Register a valid user to obtain authentication token
      const registerRes = await request(server)
        .post('/api/v1/auth/register')
        .set('x-tenant-id', 'acme-corp')
        .send({
          email: 'profile.user@acme.com',
          password: 'Password123!',
        });

      expect(registerRes.status).toBe(201);
      const { token, userId } = registerRes.body;

      // 2. Query user profile using Bearer JWT and matching x-tenant-id
      const response = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', 'acme-corp');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', userId);
      expect(response.body).toHaveProperty('email', 'profile.user@acme.com');
      expect(response.body).toHaveProperty('tenantId', 'acme-corp');
      expect(response.body).toHaveProperty('createdAt');
      expect(response.body).toHaveProperty('updatedAt');
      expect(response.body).not.toHaveProperty('passwordHash');
    });
  });

  describe('Authentication Failures (401 Unauthorized)', () => {
    it('should reject when Authorization header is missing', async () => {
      const response = await request(server)
        .get('/api/v1/auth/me')
        .set('x-tenant-id', 'acme-corp');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });

    it('should reject when Authorization format is not Bearer', async () => {
      const response = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Basic dXNlcjpwYXNz')
        .set('x-tenant-id', 'acme-corp');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });

    it('should reject when Bearer token is invalid or malformed', async () => {
      const response = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid.token.payload')
        .set('x-tenant-id', 'acme-corp');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Tenant Boundary Violations (403 Forbidden)', () => {
    it('should reject when token claims do not match the requested x-tenant-id', async () => {
      // Register user in acme-corp
      const registerRes = await request(server)
        .post('/api/v1/auth/register')
        .set('x-tenant-id', 'acme-corp')
        .send({
          email: 'acme.user@acme.com',
          password: 'Password123!',
        });

      const { token } = registerRes.body;

      // Attempt to access profile presenting token for acme-corp but declaring header for rogue-corp
      const response = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', 'rogue-corp');

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error');
    });
  });
});

