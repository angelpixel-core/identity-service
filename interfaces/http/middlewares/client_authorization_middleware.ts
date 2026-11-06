import { Request, Response, NextFunction } from 'express';
import { ClientApplicationRepositoryPort } from '../../../src/contexts/identity/domain/ports/client_application_repository_port';
import { ClientId } from '../../../src/contexts/identity/domain/value_objects/client_id/value';
import { DomainValidationError } from '../../../src/contexts/identity/domain/exceptions/user/error';

/**
 * Middleware de Autorización de Aplicaciones Cliente
 * Valida la existencia, estado activo y concordancia de orígenes para solicitudes dirigidas al IdP.
 */
export function clientAuthorizationMiddleware(clientRepository: ClientApplicationRepositoryPort) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawClientId =
        (req.headers['x-client-id'] as string) ||
        (req.body && req.body.clientId) ||
        (req.query && (req.query.client_id as string));

      if (!rawClientId || typeof rawClientId !== 'string' || rawClientId.trim().length === 0) {
        res.status(400).json({
          error: 'missing_client_id',
          message: 'Client ID is required via header "x-client-id", query parameter "client_id", or body "clientId".',
        });
        return;
      }

      let clientId: ClientId;
      try {
        clientId = ClientId.create(rawClientId);
      } catch (err: unknown) {
        const errorMsg = err instanceof DomainValidationError ? (err as DomainValidationError).message : 'Invalid client_id format';
        res.status(400).json({
          error: 'invalid_client_id',
          message: errorMsg,
        });
        return;
      }

      const client = await clientRepository.findByClientId(clientId);
      if (!client) {
        res.status(404).json({
          error: 'client_not_found',
          message: `Client application "${rawClientId}" was not found in registered_clients.`,
        });
        return;
      }

      if (!client.isActive()) {
        res.status(401).json({
          error: 'client_deactivated',
          message: `Client application "${rawClientId}" is currently deactivated.`,
        });
        return;
      }

      const originHeader = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : undefined);
      if (originHeader) {
        if (!client.isOriginAllowed(originHeader)) {
          res.status(403).json({
            error: 'unauthorized_client_origin',
            message: `Origin ${originHeader} is not authorized for client ${rawClientId}.`,
          });
          return;
        }
      }

      (req as any).clientApp = client;
      next();
    } catch (error: unknown) {
      res.status(500).json({
        error: 'internal_server_error',
        message: error instanceof Error ? error.message : 'An unexpected error occurred during client authorization',
      });
    }
  };
}