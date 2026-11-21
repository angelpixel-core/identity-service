import { ClientApplicationRepositoryPort } from '../../../../domain/ports/client_application_repository_port';
import { ClientApplication } from '../../../../domain/entities/client_application/aggregate';
import { ClientId } from '../../../../domain/value_objects/client_id/value';
import { OriginDomain } from '../../../../domain/value_objects/origin_domain/value';

/**
 * In-Memory Adapter: InMemoryClientApplicationRepository
 * Repositorio en memoria con semillas para entornos de testing y desarrollo desacoplado.
 */
export class InMemoryClientApplicationRepository implements ClientApplicationRepositoryPort {
  private readonly clients: Map<string, ClientApplication> = new Map();

  constructor(seedDefaults: boolean = true) {
    if (seedDefaults) {
      this.seedDefaultClients();
    }
  }

  public async save(client: ClientApplication): Promise<void> {
    this.clients.set(client.getClientId().getValue(), client);
  }

  public async findByClientId(clientId: ClientId): Promise<ClientApplication | null> {
    return this.clients.get(clientId.getValue()) ?? null;
  }

  public async findAll(): Promise<ClientApplication[]> {
    return Array.from(this.clients.values()).sort((a, b) =>
      a.getClientId().getValue().localeCompare(b.getClientId().getValue())
    );
  }

  private seedDefaultClients(): void {
    const portalWeb = ClientApplication.create({
      id: 'client-seed-1',
      clientId: ClientId.create('portal-web'),
      clientName: 'AngelPixel Web Portal',
      clientType: 'public',
      allowedOrigins: [OriginDomain.create('https://portal.angelpixel.io')],
      redirectUris: ['https://portal.angelpixel.io/callback'],
      allowedGrantTypes: ['authorization_code', 'refresh_token'],
      scopes: ['openid', 'profile', 'email'],
      isActive: true,
    });

    const legacyApp = ClientApplication.create({
      id: 'client-seed-2',
      clientId: ClientId.create('legacy-app'),
      clientName: 'Legacy Portal App',
      clientType: 'public',
      allowedOrigins: [OriginDomain.create('https://legacy.angelpixel.io')],
      redirectUris: ['https://legacy.angelpixel.io/callback'],
      allowedGrantTypes: ['authorization_code'],
      scopes: ['openid'],
      isActive: false,
    });

    const eCommerceSpa = ClientApplication.create({
      id: 'client-seed-3',
      clientId: ClientId.create('e-commerce-spa'),
      clientName: 'AngelPixel E-Commerce SPA',
      clientType: 'public',
      allowedOrigins: [OriginDomain.create('https://shop.local')],
      redirectUris: ['https://shop.local/callback'],
      allowedGrantTypes: ['authorization_code', 'refresh_token'],
      scopes: ['openid', 'profile', 'email'],
      isActive: true,
    });

    const m2mServiceApp = ClientApplication.create({
      id: 'client-seed-4',
      clientId: ClientId.create('m2m-service-app'),
      clientSecretHash: '$2b$06$xEZUS7jmJ1CcedNxhaSU5.FoviZ/lI0sZ49qR8kQgSiwirWZohsTi',
      clientName: 'Machine to Machine Service Worker',
      clientType: 'confidential',
      allowedOrigins: [OriginDomain.create('https://m2m.angelpixel.io')],
      redirectUris: [],
      allowedGrantTypes: ['client_credentials'],
      scopes: ['identity:read', 'identity:write', 'audit:log'],
      isActive: true,
    });

    this.clients.set(portalWeb.getClientId().getValue(), portalWeb);
    this.clients.set(legacyApp.getClientId().getValue(), legacyApp);
    this.clients.set(eCommerceSpa.getClientId().getValue(), eCommerceSpa);
    this.clients.set(m2mServiceApp.getClientId().getValue(), m2mServiceApp);
  }
}

