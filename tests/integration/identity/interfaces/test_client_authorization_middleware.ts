import express, { Request, Response } from 'express';
import request from 'supertest';
import { clientAuthorizationMiddleware } from '../../../../interfaces/http/middlewares/client_authorization_middleware';
import { ClientApplicationRepositoryPort } from '../../../../src/contexts/identity/domain/ports/client_application_repository_port';
import { ClientApplication } from '../../../../src/contexts/identity/domain/entities/client_application/aggregate';
import { ClientId } from '../../../../src/contexts/identity/domain/value_objects/client_id/value';
import { OriginDomain } from '../../../../src/contexts/identity/domain/value_objects/origin_domain/value';

describe('Integration Middleware: clientAuthorizationMiddleware', () => {
  let app: express.Express;
  let mockClientRepository: jest.Mocked<ClientApplicationRepositoryPort>;

  const activePublicClient = ClientApplication.create({
    id: 'client-1',
    clientId: ClientId.create('portal-web'),
    clientName: 'AngelSolutions Web Portal',
    clientType: 'public',
    allowedOrigins: [OriginDomain.create('https://portal.angelsolutions.io')],
    redirectUris: ['https://portal.angelsolutions.io/callback'],
    allowedGrantTypes: ['authorization_code'],
    scopes: ['openid', 'profile'],
    isActive: true,
  });

  const deactivatedClient = ClientApplication.create({
    id: 'client-2',
    clientId: ClientId.create('legacy-app'),
    clientName: 'Legacy Portal App',
    clientType: 'public',
    allowedOrigins: [OriginDomain.create('https://legacy.angelsolutions.io')],
    redirectUris: ['https://legacy.angelsolutions.io/callback'],
    allowedGrantTypes: ['authorization_code'],
    scopes: ['openid'],
    isActive: false,
  });

  beforeEach(() => {
    mockClientRepository = {
      save: jest.fn(),
      findByClientId: jest.fn(),
    };

    app = express();
    app.use(express.json());
    app.use(clientAuthorizationMiddleware(mockClientRepository));

    app.post('/api/test/client-protected', (_req: Request, res: Response) => {
      res.status(200).json({ success: true, message: 'Client authorized' });
    });
  });

  it('should accept the request when client exists, is active, and origin matches allowed_origins', async () => {
    mockClientRepository.findByClientId.mockResolvedValueOnce(activePublicClient);

    const response = await request(app)
      .post('/api/test/client-protected')
      .set('x-client-id', 'portal-web')
      .set('Origin', 'https://portal.angelsolutions.io')
      .send();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, message: 'Client authorized' });
  });

  it('should reject with 403 Forbidden when origin does not match allowed_origins', async () => {
    mockClientRepository.findByClientId.mockResolvedValueOnce(activePublicClient);

    const response = await request(app)
      .post('/api/test/client-protected')
      .set('x-client-id', 'portal-web')
      .set('Origin', 'https://malicious-site.com')
      .send();

    expect(response.status).toBe(403);
    expect(response.body).toHaveProperty('error', 'unauthorized_client_origin');
  });

  it('should reject with 401 Unauthorized when client application is deactivated', async () => {
    mockClientRepository.findByClientId.mockResolvedValueOnce(deactivatedClient);

    const response = await request(app)
      .post('/api/test/client-protected')
      .set('x-client-id', 'legacy-app')
      .set('Origin', 'https://legacy.angelsolutions.io')
      .send();

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('error', 'client_deactivated');
  });

  it('should reject with 404 Not Found when client_id does not exist', async () => {
    mockClientRepository.findByClientId.mockResolvedValueOnce(null);

    const response = await request(app)
      .post('/api/test/client-protected')
      .set('x-client-id', 'unknown-client')
      .set('Origin', 'https://portal.angelsolutions.io')
      .send();

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('error', 'client_not_found');
  });

  it('should reject with 400 Bad Request when client_id is not provided', async () => {
    const response = await request(app)
      .post('/api/test/client-protected')
      .set('Origin', 'https://portal.angelsolutions.io')
      .send();

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error', 'missing_client_id');
  });
});

