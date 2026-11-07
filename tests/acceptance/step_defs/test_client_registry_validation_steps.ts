import http from 'http';
import request from 'supertest';
import { createApp } from '../../../interfaces/http/server';

describe('Feature: Dynamic Client Registry and Origin Validation', () => {
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

  describe('Scenario: Successful validation of a registered public SPA client', () => {
    it('should accept the request when origin matches allowed_origins and client is active', async () => {
      const response = await request(server)
        .post('/api/v1/oauth2/clients/validate')
        .set('Origin', 'https://portal.angelsolutions.io')
        .send({
          clientId: 'portal-web',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('authorized', true);
      expect(response.body).toHaveProperty('clientId', 'portal-web');
      expect(response.body).toHaveProperty('clientType', 'public');
    });
  });

  describe('Scenario: Rejection of unregistered origin for a valid client', () => {
    it('should reject request with HTTP 403 Forbidden when origin is not allowed', async () => {
      const response = await request(server)
        .post('/api/v1/oauth2/clients/validate')
        .set('Origin', 'https://malicious-site.com')
        .send({
          clientId: 'portal-web',
        });

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'unauthorized_client_origin');
      expect(response.body).toHaveProperty('message');
    });
  });

  describe('Scenario: Rejection of inactive client application', () => {
    it('should reject request with HTTP 401 Unauthorized when client is deactivated', async () => {
      const response = await request(server)
        .post('/api/v1/oauth2/clients/validate')
        .set('Origin', 'https://legacy.angelsolutions.io')
        .send({
          clientId: 'legacy-app',
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'client_deactivated');
    });
  });
});

