import { ClientApplicationRepositoryPort } from '../../../domain/ports/client_application_repository_port';
import { CacheProviderPort } from '../../ports/cache/cache_provider';
import { ClientId } from '../../../domain/value_objects/client_id/value';
import { OriginDomain } from '../../../domain/value_objects/origin_domain/value';
import { DomainValidationError } from '../../../domain/exceptions/user/error';
import { ValidateClientOriginQuery } from './query';
import {
  CachedRegisteredClientDTO,
  ClientValidationResultDTO,
} from '../../dtos/client_validation/dto';

/**
 * Caso de uso (Read Slice): Validación de aplicación cliente registrada y origen permitido con patrón Cache-Aside.
 * 1. Valida formato de `clientId` mediante el Value Object `ClientId`.
 * 2. Intenta recuperar el snapshot sanitizado del cliente desde la caché (`registered_client:{clientId}`).
 * 3. Ante Cache Miss, consulta `ClientApplicationRepositoryPort` y almacena el snapshot sin secretos con TTL (default 300s).
 * 4. Evalúa estado activo (`isActive`) y concordancia de `OriginDomain`.
 */
export class ValidateClientOriginQueryHandler {
  constructor(
    private readonly clientRepository: ClientApplicationRepositoryPort,
    private readonly cacheProvider: CacheProviderPort,
    private readonly defaultTtlSeconds: number = 300
  ) {}

  public async execute(query: ValidateClientOriginQuery): Promise<ClientValidationResultDTO> {
    const rawClientId = query.clientId;

    if (!rawClientId || typeof rawClientId !== 'string' || rawClientId.trim().length === 0) {
      return {
        authorized: false,
        clientId: '',
        errorCode: 'missing_client_id',
        message:
          'Client ID is required via header "x-client-id", query parameter "client_id", or body "clientId".',
      };
    }

    let clientId: ClientId;
    try {
      clientId = ClientId.create(rawClientId);
    } catch (err: unknown) {
      const errorMsg =
        err instanceof DomainValidationError ? err.message : 'Invalid client_id format';
      return {
        authorized: false,
        clientId: rawClientId,
        errorCode: 'invalid_client_id',
        message: errorMsg,
      };
    }

    const cacheKey = `registered_client:${clientId.getValue()}`;

    // 1. Intento de lectura desde caché (Cache Hit)
    let clientSnapshot = await this.cacheProvider.get<CachedRegisteredClientDTO>(cacheKey);

    // 2. Cache Miss: Consulta a la persistencia y población de caché sanitizada
    if (!clientSnapshot) {
      const client = await this.clientRepository.findByClientId(clientId);
      if (!client) {
        return {
          authorized: false,
          clientId: clientId.getValue(),
          errorCode: 'client_not_found',
          message: `Client application "${clientId.getValue()}" was not found in registered_clients.`,
        };
      }

      clientSnapshot = {
        id: client.getId(),
        clientId: client.getClientId().getValue(),
        clientName: client.getClientName(),
        clientType: client.getClientType(),
        allowedOrigins: client.getAllowedOrigins().map((o) => o.getValue()),
        redirectUris: client.getRedirectUris(),
        allowedGrantTypes: client.getAllowedGrantTypes(),
        scopes: client.getScopes(),
        isActive: client.isActive(),
      };

      await this.cacheProvider.set(cacheKey, clientSnapshot, this.defaultTtlSeconds);
    }

    // 3. Evaluación de estado activo del cliente
    if (!clientSnapshot.isActive) {
      return {
        authorized: false,
        clientId: clientSnapshot.clientId,
        clientType: clientSnapshot.clientType,
        errorCode: 'client_deactivated',
        message: `Client application "${clientSnapshot.clientId}" is currently deactivated.`,
      };
    }

    // 4. Evaluación de origen si se proporciona en la solicitud (CORS / Redirect URI)
    if (query.origin) {
      let isOriginAuthorized = false;
      try {
        const requestedOrigin = OriginDomain.create(query.origin);
        isOriginAuthorized = clientSnapshot.allowedOrigins.some((allowedRaw) =>
          OriginDomain.create(allowedRaw).equals(requestedOrigin)
        );
      } catch {
        isOriginAuthorized = false;
      }

      if (!isOriginAuthorized) {
        return {
          authorized: false,
          clientId: clientSnapshot.clientId,
          clientType: clientSnapshot.clientType,
          errorCode: 'unauthorized_client_origin',
          message: `Origin ${query.origin} is not authorized for client ${clientSnapshot.clientId}.`,
        };
      }
    }

    return {
      authorized: true,
      clientId: clientSnapshot.clientId,
      clientName: clientSnapshot.clientName,
      clientType: clientSnapshot.clientType,
      allowedOrigins: [...clientSnapshot.allowedOrigins],
      redirectUris: [...clientSnapshot.redirectUris],
      allowedGrantTypes: [...clientSnapshot.allowedGrantTypes],
      scopes: [...clientSnapshot.scopes],
    };
  }
}

