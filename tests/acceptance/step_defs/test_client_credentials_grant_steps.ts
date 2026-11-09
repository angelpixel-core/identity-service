import http from 'http';
import request from 'supertest';
import { createApp } from '../../../interfaces/http/server';
import { InMemoryClientApplicationRepository } from '../../../src/contexts/identity/infrastructure/persistence/repositories/client_application/in_memory_client_repository';
import { ClientApplication } from '../../../src/contexts/identity/domain/entities/client_application/aggregate';
import { ClientId } from '../../../src/contexts/identity/domain/value_objects/client_id/value';
import { OriginDomain } from '../../../src/contexts/identity/domain/value_objects/origin_domain/value';
import { BcryptAdapter } from '../../../src/contexts/identity/infrastructure/security/bcrypt_adapter';

describe('Feature: Client Credentials Scoped Grant', () => {
  let server: http.Server;
  let clientRepository: InMemoryClientApplicationRepository;
  const hashProvider = new BcryptAdapter(4);

  beforeAll(async () => {
    clientRepository = new InMemoryClientApplicationRepository(true);

    const validSecretHash = await hashProvider.hash('ValidSecret123!_SuperSecureSecretForTesting_2026');
    const workerSecretHash = await hashProvider.hash('WorkerSecret123!_SuperSecureSecretForTesting_2026');

    const orderServiceClient = ClientApplication.create({
      id: 'client-order-service-uuid',
      clientId: ClientId.create('order-service'),
      clientSecretHash: validSecretHash,
      clientName: 'Order Microservice Satelite',
      clientType: 'confidential',
      allowedOrigins: [OriginDomain.create('https://orders.angelpixel.io')],
      redirectUris: [],
      allowedGrantTypes: ['client_credentials'],
      scopes: ['identity:read'],
      isActive: true,
    });

    const analyticsWorkerClient = ClientApplication.create({
      id: 'client-analytics-worker-uuid',
      clientId: ClientId.create('analytics-worker'),
      clientSecretHash: workerSecretHash,
      clientName: 'Analytics Background Worker',
      clientType: 'confidential',
      allowedOrigins: [OriginDomain.create('https://analytics.angelpixel.io')],
      redirectUris: [],
      allowedGrantTypes: ['client_credentials'],
      scopes: ['metrics:write'],
      isActive: true,
    });

    await clientRepository.save(orderServiceClient);
    await clientRepository.save(analyticsWorkerClient);
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

  describe('Scenario: Successful machine-to-machine authentication with authorized scopes', () => {
    it('should authenticate confidential client and return 200 OK with Bearer access token', async () => {
      const response = await request(server)
        .post('/api/v1/oauth2/token')
        .send({
          grant_type: 'client_credentials',
          client_id: 'order-service',
          client_secret: 'ValidSecret123!_SuperSecureSecretForTesting_2026',
          scope: 'identity:read',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('access_token');
      expect(response.body).toHaveProperty('token_type', 'Bearer');
      expect(response.body).toHaveProperty('expires_in', 3600);
      expect(response.body).toHaveProperty('scope', 'identity:read');
    });
  });

  describe('Scenario: Rejection of client credentials request from a public client', () => {
    it('should reject public client request with HTTP 400 and error unauthorized_client', async () => {
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
  });

  describe('Scenario: Rejection of unauthorized scopes', () => {
    it('should reject request requesting scopes not granted with HTTP 400 and error invalid_scope', async () => {
      const response = await request(server)
        .post('/api/v1/oauth2/token')
        .send({
          grant_type: 'client_credentials',
          client_id: 'analytics-worker',
          client_secret: 'WorkerSecret123!_SuperSecureSecretForTesting_2026',
          scope: 'identity:admin',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'invalid_scope');
    });
  });

  describe('Scenario: Rejection of invalid client secret', () => {
    it('should reject request with mismatched client secret with HTTP 401 and error invalid_client', async () => {
      const response = await request(server)
        .post('/api/v1/oauth2/token')
        .send({
          grant_type: 'client_credentials',
          client_id: 'order-service',
          client_secret: 'WrongSecret123!_SuperSecureSecretForTesting_2026',
          scope: 'identity:read',
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'invalid_client');
    });
  });
});

