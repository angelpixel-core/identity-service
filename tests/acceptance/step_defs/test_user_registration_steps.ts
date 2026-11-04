import request from 'supertest';
// Intentionally importing the Express app which will be implemented in interfaces/http/server.ts
// @ts-expect-error - Module will be created in interfaces/http/server.ts during slice assembly
import { app } from '../../../interfaces/http/server';

describe('Feature: Tenant User Registration (BDD Acceptance)', () => {
  describe('Scenario: Successful tenant user registration', () => {
    it('should register user and return 201 with JWT containing tenantId claim', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          tenantId: 'acme-corp',
          email: 'user@acme.com',
          password: 'SecurePass123!',
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('accessToken');
    });
  });

  describe('Scenario: Registration failure due to invalid email format', () => {
    it('should return 400 Bad Request when email format is invalid', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          tenantId: 'acme-corp',
          email: 'invalid-email-format',
          password: 'SecurePass123!',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Scenario: Registration failure due to duplicate email in same tenant', () => {
    it('should return 409 Conflict when user already exists in same tenant', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          tenantId: 'acme-corp',
          email: 'user@acme.com',
          password: 'SecurePass123!',
        });

      expect(response.status).toBe(409);
      expect(response.body).toHaveProperty('error');
    });
  });
});
