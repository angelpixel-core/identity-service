import { ClientApplication } from '../entities/client_application/aggregate';
import { ClientId } from '../value_objects/client_id/value';

/**
 * Secondary Port: ClientApplicationRepositoryPort
 * Define las operaciones de persistencia para el agregado ClientApplication.
 */
export interface ClientApplicationRepositoryPort {
  save(client: ClientApplication): Promise<void>;
  findByClientId(clientId: ClientId): Promise<ClientApplication | null>;
}

