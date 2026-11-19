import { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../../../interfaces/http/server';

describe('Integration API: DELETE /api/v1/users/:userId and Ops Reseed', () => {
  let app: Express;

  beforeEach(() => {
    app = createApp();
  });

  describe('Happy Path: User Hard Deletion (204 No Content)', () => {
    it('should physically delete user and return 204 No Content, then subsequent GET returns 404', async () => {
      const uniqueEmail = `delete.${Date.now()}.${Math.random().toString(36).substring(7)}@acme.com`;

      // 1. Register user
      const registerRes = await request(app)
        .post('/api/v1/auth/register')
        .set('x-tenant-id', 'acme-corp')
        .send({
          email: uniqueEmail,
          password: 'Password123!',
        });

      expect(registerRes.status).toBe(201);
      const { token, userId } = registerRes.body;

      // 2. Verify user exists via GET /api/v1/users/:userId
      const getBeforeRes = await request(app)
        .get(`/api/v1/users/${userId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', 'acme-corp');

      expect(getBeforeRes.status).toBe(200);
      expect(getBeforeRes.body).toHaveProperty('id', userId);

      // 3. Delete user via DELETE /api/v1/users/:userId
      const deleteRes = await request(app)
        .delete(`/api/v1/users/${userId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', 'acme-corp');

      expect(deleteRes.status).toBe(204);
      expect(deleteRes.text).toBe('');

      // 4. Verify subsequent GET returns 404
      const getAfterRes = await request(app)
        .get(`/api/v1/users/${userId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', 'acme-corp');

      expect(getAfterRes.status).toBe(404);

      // 5. Subsequent DELETE returns 404 (anti-enumeration / already deleted)
      const repeatDeleteRes = await request(app)
        .delete(`/api/v1/users/${userId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', 'acme-corp');

      expect(repeatDeleteRes.status).toBe(404);
    });
  });

  describe('Cross-Tenant Isolation & Anti-Enumeration (404 Not Found)', () => {
    it('should return 404 when attempting to delete a user belonging to another tenant', async () => {
      const emailA = `tenantA.${Date.now()}.${Math.random().toString(36).substring(7)}@corp-a.com`;
      const emailB = `tenantB.${Date.now()}.${Math.random().toString(36).substring(7)}@corp-b.com`;

      // Register user in corp-a
      const resA = await request(app)
        .post('/api/v1/auth/register')
        .set('x-tenant-id', 'corp-a')
        .send({ email: emailA, password: 'Password123!' });
      expect(resA.status).toBe(201);
      const userAId = resA.body.userId;

      // Register user in corp-b
      const resB = await request(app)
        .post('/api/v1/auth/register')
        .set('x-tenant-id', 'corp-b')
        .send({ email: emailB, password: 'Password123!' });
      expect(resB.status).toBe(201);
      const tokenB = resB.body.token;

      // User B in corp-b attempts to delete User A from corp-a
      const crossDeleteRes = await request(app)
        .delete(`/api/v1/users/${userAId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .set('x-tenant-id', 'corp-b');

      expect(crossDeleteRes.status).toBe(404);
      expect(crossDeleteRes.body).toHaveProperty('error', 'User not found');

      // Verify User A still exists in corp-a
      const tokenA = resA.body.token;
      const checkRes = await request(app)
        .get(`/api/v1/users/${userAId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('x-tenant-id', 'corp-a');
      expect(checkRes.status).toBe(200);
    });
  });

  describe('Tenant Boundary Guard & Authentication (401 / 403)', () => {
    it('should reject with 401 when Authorization header is missing', async () => {
      const response = await request(app)
        .delete('/api/v1/users/any-user-id')
        .set('x-tenant-id', 'acme-corp');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });

    it('should reject with 403 when token tenant does not match x-tenant-id header', async () => {
      const email = `tenantMismatch.${Date.now()}@acme.com`;
      const registerRes = await request(app)
        .post('/api/v1/auth/register')
        .set('x-tenant-id', 'acme-corp')
        .send({ email, password: 'Password123!' });

      const { token, userId } = registerRes.body;

      const response = await request(app)
        .delete(`/api/v1/users/${userId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', 'rogue-corp');

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Operational Endpoint: POST /api/v1/ops/reseed-dev-sessions', () => {
    it('should reseed dev refresh session successfully in non-production', async () => {
      const response = await request(app)
        .post('/api/v1/ops/reseed-dev-sessions')
        .send();

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'Dev refresh session re-seeded successfully',
        client_id: 'portal-web',
        refresh_token: 'seed_refresh_token_portal_web_dev_2026',
      });

      // Verify that this refreshed token can be used in /oauth2/refresh
      const refreshRes = await request(app)
        .post('/oauth2/refresh')
        .send({
          client_id: 'portal-web',
          refresh_token: 'seed_refresh_token_portal_web_dev_2026',
        });

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body).toHaveProperty('access_token');
      expect(refreshRes.headers['set-cookie']).toBeDefined();
    });

    it('should return 403 Forbidden in production environment', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        const response = await request(app)
          .post('/api/v1/ops/reseed-dev-sessions')
          .send();

        expect(response.status).toBe(403);
        expect(response.body).toHaveProperty('error', 'forbidden');
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });
});
