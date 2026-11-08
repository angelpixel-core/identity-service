import request from 'supertest';
import { createApp } from '../../../../interfaces/http/server';

describe('Integration API: OpenAPI Specification & Swagger UI (/api/docs)', () => {
  const app = createApp();

  it('should serve Swagger UI HTML page at /api/docs/', async () => {
    const response = await request(app).get('/api/docs/');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.text).toContain('Swagger UI');
  });

  it('should serve complete parsed OpenAPI 3.1 JSON at /api/docs/openapi.json', async () => {
    const response = await request(app).get('/api/docs/openapi.json');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toHaveProperty('openapi', '3.1.0');
    expect(response.body.info).toHaveProperty('title', 'AngelPixel Identity Service API');
    expect(response.body.paths).toHaveProperty('/api/v1/auth/register');
    expect(response.body.paths).toHaveProperty('/api/v1/auth/me');
    expect(response.body.paths).toHaveProperty('/api/v1/oauth2/clients/validate');
    expect(response.body.paths).toHaveProperty('/api/v1/oauth2/token');
    expect(response.body.paths).toHaveProperty('/oauth2/token');
  });

  it('should serve raw OpenAPI YAML file at /api/docs/openapi.yaml', async () => {
    const response = await request(app).get('/api/docs/openapi.yaml');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/yaml/);
    expect(response.text).toContain('openapi: 3.1.0');
    expect(response.text).toContain('AngelPixel Identity Service API');
  });
});

