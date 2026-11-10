import http from 'http';
import request from 'supertest';
import { createApp } from '../../../../interfaces/http/server';
import { InMemoryClientApplicationRepository } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/client_application/in_memory_client_repository';
import { ClientApplication } from '../../../../src/contexts/identity/domain/entities/client_application/aggregate';
import { ClientId } from '../../../../src/contexts/identity/domain/value_objects/client_id/value';
import { OriginDomain } from '../../../../src/contexts/identity/domain/value_objects/origin_domain/value';
import { BcryptAdapter } from '../../../../src/contexts/identity/infrastructure/security/bcrypt_adapter';

describe('Integration API: POST /api/v1/oauth2/token (RFC 6749 Client Credentials Grant)', () => {
  let server: http.Server;
  let clientRepository: InMemoryClientApplicationRepository;
  const hashProvider = new BcryptAdapter(4);

  beforeAll(async () => {
    clientRepository = new InMemoryClientApplicationRepository(true);

    const validSecretHash = await hashProvider.hash('ValidSecret123!_SuperSecureSecretForTesting_2026');

    const orderServiceClient = ClientApplication.create({
      id: 'client-m2m-order-service-uuid',
      clientId: ClientId.create('order-service'),
      clientSecretHash: validSecretHash,
      clientName: 'Order Microservice Satellite',
      clientType: 'confidential',
      allowedOrigins: [OriginDomain.create('https://orders.angelpixel.io')],
      redirectUris: [],
      allowedGrantTypes: ['client_credentials'],
      scopes: ['identity:read', 'orders:write'],
      isActive: true,
    });

    const deactivatedClient = ClientApplication.create({
      id: 'client-m2m-deactivated-uuid',
      clientId: ClientId.create('deactivated-worker'),
      clientSecretHash: validSecretHash,
      clientName: 'Deactivated Worker',
      clientType: 'confidential',
      allowedOrigins: [OriginDomain.create('https://worker.angelpixel.io')],
      redirectUris: [],
      allowedGrantTypes: ['client_credentials'],
      scopes: ['identity:read'],
      isActive: false,
    });

    await clientRepository.save(orderServiceClient);
    await clientRepository.save(deactivatedClient);
  });

  beforeEach((done) => {
    const app = createApp({ clientRepository, hashProvider });
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

  describe('Happy Path: Successful Client Credentials Grant (200 OK)', () => {
    it('should issue Bearer JWT access token with JSON payload and authorized scope', async () => {
      const response = await request(server)
        .post('/api/v1/oauth2/token')
        .send({
          grant_type: 'client_credentials',
          client_id: 'order-service',
          client_secret: 'ValidSecret123!_SuperSecureSecretForTesting_2026',
          scope: 'identity:read',
        });

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.headers['pragma']).toBe('no-cache');
      expect(response.body).toHaveProperty('access_token');
      expect(typeof response.body.access_token).toBe('string');
      expect(response.body).toHaveProperty('token_type', 'Bearer');
      expect(response.body).toHaveProperty('expires_in', 3600);
      expect(response.body).toHaveProperty('scope', 'identity:read');
    });

    it('should support application/x-www-form-urlencoded content type per RFC 6749 Section 4.4.2', async () => {
      const response = await request(server)
        .post('/api/v1/oauth2/token')
        .type('form')
        .send({
          grant_type: 'client_credentials',
          client_id: 'order-service',
          client_secret: 'ValidSecret123!_SuperSecureSecretForTesting_2026',
          scope: 'identity:read',
        });

      expect(response.status).toBe(200);
      expect(response.body.token_type).toBe('Bearer');
      expect(response.body.access_token).toBeDefined();
    });

    it('should authenticate client credentials via HTTP Basic Authorization header', async () => {
      const credentials = Buffer.from('order-service:ValidSecret123!_SuperSecureSecretForTesting_2026').toString('base64');

      const response = await request(server)
        .post('/api/v1/oauth2/token')
        .set('Authorization', `Basic ${credentials}`)
        .send({
          grant_type: 'client_credentials',
          scope: 'identity:read',
        });

      expect(response.status).toBe(200);
      expect(response.body.token_type).toBe('Bearer');
      expect(response.body.access_token).toBeDefined();
    });

    it('should default to all client scopes when no scope parameter is requested', async () => {
      const response = await request(server)
        .post('/api/v1/oauth2/token')
        .send({
          grant_type: 'client_credentials',
          client_id: 'order-service',
          client_secret: 'ValidSecret123!_SuperSecureSecretForTesting_2026',
        });

      expect(response.status).toBe(200);
      expect(response.body.scope).toBe('identity:read orders:write');
    });
  });

  describe('Validation & Protocol Violations (400 Bad Request)', () => {
    it('should reject when client_id is missing with error invalid_request', async () => {
      const response = await request(server)
        .post('/api/v1/oauth2/token')
        .send({
          grant_type: 'client_credentials',
          client_secret: 'ValidSecret123!_SuperSecureSecretForTesting_2026',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'invalid_request');
      expect(response.body.error_description).toContain('client_id');
    });

    it('should reject when grant_type is missing with error invalid_request', async () => {
      const response = await request(server)
        .post('/api/v1/oauth2/token')
        .send({
          client_id: 'order-service',
          client_secret: 'ValidSecret123!_SuperSecureSecretForTesting_2026',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'invalid_request');
    });

    it('should reject when grant_type is not supported with error unsupported_grant_type', async () => {
      const response = await request(server)
        .post('/api/v1/oauth2/token')
        .send({
          grant_type: 'password',
          client_id: 'order-service',
          client_secret: 'ValidSecret123!_SuperSecureSecretForTesting_2026',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'unsupported_grant_type');
    });

    it('should reject client_credentials from public client with error unauthorized_client', async () => {
      const response = await request(server)
        .post('/api/v1/oauth2/token')
        .send({
          grant_type: 'client_credentials',
          client_id: 'portal-web',
          client_secret: '',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'unauthorized_client');
    });

    it('should reject when requested scope exceeds client permissions with error invalid_scope', async () => {
      const response = await request(server)
        .post('/api/v1/oauth2/token')
        .send({
          grant_type: 'client_credentials',
          client_id: 'order-service',
          client_secret: 'ValidSecret123!_SuperSecureSecretForTesting_2026',
          scope: 'identity:admin',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'invalid_scope');
    });
  });

  describe('Authentication Failures (401 Unauthorized)', () => {
    it('should reject with 401 and error invalid_client when client_secret is incorrect', async () => {
      const response = await request(server)
        .post('/api/v1/oauth2/token')
        .send({
          grant_type: 'client_credentials',
          client_id: 'order-service',
          client_secret: 'MismatchedSecret999!_SuperSecureSecretForTesting_2026',
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'invalid_client');
    });

    it('should reject with 401 and error invalid_client when client_id does not exist', async () => {
      const response = await request(server)
        .post('/api/v1/oauth2/token')
        .send({
          grant_type: 'client_credentials',
          client_id: 'non-existent-client',
          client_secret: 'AnySecret123!',
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'invalid_client');
    });

    it('should reject with 401 and error invalid_client when client is deactivated', async () => {
      const response = await request(server)
        .post('/api/v1/oauth2/token')
        .send({
          grant_type: 'client_credentials',
          client_id: 'deactivated-worker',
          client_secret: 'ValidSecret123!_SuperSecureSecretForTesting_2026',
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'invalid_client');
    });
  });
});

