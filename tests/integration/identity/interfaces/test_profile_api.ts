import { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../../../interfaces/http/server';

describe('Integration API: GET /api/v1/auth/me', () => {
  let app: Express;

  beforeEach(() => {
    app = createApp();
  });

  describe('Happy Path: Authenticated Profile Retrieval (200 OK)', () => {
    it('should return sanitized user profile for authenticated tenant user', async () => {
      const uniqueEmail = `profile.${Date.now()}.${Math.random().toString(36).substring(7)}@acme.com`;

      // 1. Register a valid user to obtain authentication token
      const registerRes = await request(app)
        .post('/api/v1/auth/register')
        .set('x-tenant-id', 'acme-corp')
        .send({
          email: uniqueEmail,
          password: 'Password123!',
        });

      expect(registerRes.status).toBe(201);
      const { token, userId } = registerRes.body;

      // 2. Query user profile using Bearer JWT and matching x-tenant-id
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', 'acme-corp');

      expect(response.status).toBe(200);
      expect(response.headers['x-cache']).toBe('MISS');
      expect(response.body).toHaveProperty('id', userId);
      expect(response.body).toHaveProperty('email', uniqueEmail);
      expect(response.body).toHaveProperty('tenantId', 'acme-corp');
      expect(response.body).toHaveProperty('createdAt');
      expect(response.body).toHaveProperty('updatedAt');
      expect(response.body).not.toHaveProperty('passwordHash');

      // 3. Second request must hit Redis/in-memory cache
      const cachedResponse = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', 'acme-corp');

      expect(cachedResponse.status).toBe(200);
      expect(cachedResponse.headers['x-cache']).toBe('HIT');
    });
  });

  describe('Authentication Failures (401 Unauthorized)', () => {
    it('should reject when Authorization header is missing', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('x-tenant-id', 'acme-corp');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });

    it('should reject when Authorization format is not Bearer', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Basic dXNlcjpwYXNz')
        .set('x-tenant-id', 'acme-corp');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });

    it('should reject when Bearer token is invalid or malformed', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid.token.payload')
        .set('x-tenant-id', 'acme-corp');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Tenant Boundary Violations (403 Forbidden)', () => {
    it('should reject when token claims do not match the requested x-tenant-id', async () => {
      const boundaryEmail = `boundary.${Date.now()}.${Math.random().toString(36).substring(7)}@acme.com`;

      // Register user in acme-corp
      const registerRes = await request(app)
        .post('/api/v1/auth/register')
        .set('x-tenant-id', 'acme-corp')
        .send({
          email: boundaryEmail,
          password: 'Password123!',
        });

      const { token } = registerRes.body;

      // Attempt to access profile presenting token for acme-corp but declaring header for rogue-corp
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', 'rogue-corp');

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error');
    });
  });
});

