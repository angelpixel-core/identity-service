import request from 'supertest';
// @ts-expect-error - Module will be implemented in the green phase
import { createApp } from '../../../../interfaces/http/server';

describe('Integration API: POST /api/v1/auth/register', () => {
  let app: any;

  beforeEach(() => {
    app = createApp();
  });

  describe('Happy Path: User Registration (201 Created)', () => {
    it('should successfully register a new tenant user and return 201 with auth token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .set('x-tenant-id', 'acme-corp')
        .send({
          email: 'valid.user@acme.com',
          password: 'SecurePassword123!',
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('token');
      expect(typeof response.body.token).toBe('string');
      expect(response.body).toHaveProperty('userId');
      expect(response.body.email).toBe('valid.user@acme.com');
      expect(response.body.tenantId).toBe('acme-corp');
      expect(response.body).toHaveProperty('createdAt');
    });
  });

  describe('Validation Failures (400 Bad Request)', () => {
    it('should reject when x-tenant-id header is missing or empty', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'user@acme.com',
          password: 'SecurePassword123!',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should reject when email format is invalid', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .set('x-tenant-id', 'acme-corp')
        .send({
          email: 'not-an-email',
          password: 'SecurePassword123!',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should reject when password is shorter than 8 characters', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .set('x-tenant-id', 'acme-corp')
        .send({
          email: 'valid.user@acme.com',
          password: 'short',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should reject when request body is empty', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .set('x-tenant-id', 'acme-corp')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Business Rule Violations: Duplicate Registration (409 Conflict)', () => {
    it('should return 409 Conflict when attempting to register duplicate email within same tenant', async () => {
      // First registration
      const firstResponse = await request(app)
        .post('/api/v1/auth/register')
        .set('x-tenant-id', 'acme-corp')
        .send({
          email: 'duplicate.user@acme.com',
          password: 'SecurePassword123!',
        });

      expect(firstResponse.status).toBe(201);

      // Duplicate registration attempt
      const duplicateResponse = await request(app)
        .post('/api/v1/auth/register')
        .set('x-tenant-id', 'acme-corp')
        .send({
          email: 'duplicate.user@acme.com',
          password: 'SecurePassword123!',
        });

      expect(duplicateResponse.status).toBe(409);
      expect(duplicateResponse.body).toHaveProperty('error');
      expect(duplicateResponse.body.error).toContain('already exists');
    });

    it('should allow registering the same email under a different tenant (multi-tenant isolation)', async () => {
      // Register in tenant A
      const tenantAResponse = await request(app)
        .post('/api/v1/auth/register')
        .set('x-tenant-id', 'acme-corp')
        .send({
          email: 'shared.email@global.com',
          password: 'SecurePassword123!',
        });

      expect(tenantAResponse.status).toBe(201);

      // Register same email in tenant B
      const tenantBResponse = await request(app)
        .post('/api/v1/auth/register')
        .set('x-tenant-id', 'beta-corp')
        .send({
          email: 'shared.email@global.com',
          password: 'SecurePassword123!',
        });

      expect(tenantBResponse.status).toBe(201);
      expect(tenantBResponse.body.tenantId).toBe('beta-corp');
      expect(tenantBResponse.body.userId).not.toBe(tenantAResponse.body.userId);
    });
  });
});

