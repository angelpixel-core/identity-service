import { ClientApplication } from '../../../../src/contexts/identity/domain/entities/client_application/aggregate';
import { ClientId } from '../../../../src/contexts/identity/domain/value_objects/client_id/value';
import { OriginDomain } from '../../../../src/contexts/identity/domain/value_objects/origin_domain/value';
import { ClientApplicationRepositoryPort } from '../../../../src/contexts/identity/domain/ports/client_application_repository_port';
import { PostgresClientApplicationRepository, DatabaseClient } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/client_application/postgres_client_repository';

describe('Infrastructure Persistence: PostgresClientApplicationRepository', () => {
  let mockDbClient: {
    query: jest.Mock;
  };
  let repository: ClientApplicationRepositoryPort;

  const validClientId = ClientId.create('portal-web');
  const validOrigin = OriginDomain.create('https://portal.angelpixel.io');

  const validClient = ClientApplication.create({
    id: 'client-uuid-2001',
    clientId: validClientId,
    clientName: 'AngelPixel Web Portal',
    clientType: 'public',
    allowedOrigins: [validOrigin],
    redirectUris: ['https://portal.angelpixel.io/callback'],
    allowedGrantTypes: ['authorization_code', 'refresh_token'],
    scopes: ['openid', 'profile', 'email'],
    isActive: true,
  });

  const rawClientRow = {
    id: 'client-uuid-2001',
    client_id: 'portal-web',
    client_secret_hash: null,
    client_name: 'AngelPixel Web Portal',
    client_type: 'public',
    allowed_origins: ['https://portal.angelpixel.io'],
    redirect_uris: ['https://portal.angelpixel.io/callback'],
    allowed_grant_types: ['authorization_code', 'refresh_token'],
    scopes: ['openid', 'profile', 'email'],
    is_active: true,
    created_at: new Date('2026-11-05T12:00:00.000Z'),
    updated_at: new Date('2026-11-05T12:00:00.000Z'),
  };

  beforeEach(() => {
    mockDbClient = {
      query: jest.fn(),
    };
    repository = new PostgresClientApplicationRepository(mockDbClient as unknown as DatabaseClient);
  });

  describe('save', () => {
    it('should persist a new client application using parameterized SQL query', async () => {
      mockDbClient.query.mockResolvedValueOnce({ rows: [] });

      await repository.save(validClient);

      expect(mockDbClient.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDbClient.query.mock.calls[0];

      expect(sql).toContain('INSERT INTO registered_clients');
      expect(sql).toContain('client_id');
      expect(sql).toContain('allowed_origins');
      expect(params).toEqual([
        validClient.getId(),
        validClient.getClientId().getValue(),
        null,
        validClient.getClientName(),
        validClient.getClientType(),
        ['https://portal.angelpixel.io'],
        validClient.getRedirectUris(),
        validClient.getAllowedGrantTypes(),
        validClient.getScopes(),
        validClient.isActive(),
        validClient.getCreatedAt(),
        validClient.getUpdatedAt(),
      ]);
    });
  });

  describe('findByClientId', () => {
    it('should retrieve a client application by its client_id', async () => {
      mockDbClient.query.mockResolvedValueOnce({ rows: [rawClientRow] });

      const client = await repository.findByClientId(validClientId);

      expect(mockDbClient.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDbClient.query.mock.calls[0];

      expect(sql).toContain('SELECT');
      expect(sql).toContain('FROM registered_clients');
      expect(sql).toContain('WHERE client_id = $1');
      expect(params).toEqual(['portal-web']);

      expect(client).not.toBeNull();
      expect(client?.getClientId().getValue()).toBe('portal-web');
      expect(client?.getClientType()).toBe('public');
      expect(client?.getAllowedOrigins()[0]?.getValue()).toBe('https://portal.angelpixel.io');
    });

    it('should return null when client_id does not exist', async () => {
      mockDbClient.query.mockResolvedValueOnce({ rows: [] });

      const client = await repository.findByClientId(ClientId.create('non-existent-client'));

      expect(client).toBeNull();
    });
  });
});

