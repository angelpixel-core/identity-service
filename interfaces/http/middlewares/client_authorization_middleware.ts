import { Request, Response, NextFunction } from 'express';
import { ClientApplicationRepositoryPort } from '../../../src/contexts/identity/domain/ports/client_application_repository_port';
import { CacheProviderPort } from '../../../src/contexts/identity/application/ports/cache/cache_provider';
import { ValidateClientOriginQueryHandler } from '../../../src/contexts/identity/application/queries/validate_client_origin/handler';
import { ClientValidationResultDTO } from '../../../src/contexts/identity/application/dtos/client_validation/dto';
import {
  extractClientValidationParams,
  mapValidationErrorToHttpStatus,
} from '../rest/v1/oauth2/client_controller';

/**
 * Adaptador de caché nulo (Pass-Through) utilizado cuando el middleware recibe
 * directamente un repositorio sin proveedor de caché explícito.
 */
class PassThroughCacheAdapter implements CacheProviderPort {
  public async get<T>(_key: string): Promise<T | null> {
    return null;
  }

  public async set<T>(_key: string, _value: T, _ttlSeconds?: number): Promise<void> {
    // No-op
  }

  public async delete(_key: string): Promise<void> {
    // No-op
  }
}

/**
 * Middleware de Autorización de Aplicaciones Cliente
 * Delega la verificación de existencia, estado activo y concordancia de orígenes
 * al caso de uso `ValidateClientOriginQueryHandler`.
 */
export function clientAuthorizationMiddleware(
  repositoryOrHandler: ClientApplicationRepositoryPort | ValidateClientOriginQueryHandler
) {
  const handler =
    repositoryOrHandler instanceof ValidateClientOriginQueryHandler
      ? repositoryOrHandler
      : new ValidateClientOriginQueryHandler(
          repositoryOrHandler,
          new PassThroughCacheAdapter(),
          0
        );

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const params = extractClientValidationParams(req);
      const result = await handler.execute(params);

      if (!result.authorized) {
        const status = mapValidationErrorToHttpStatus(result.errorCode);
        res.status(status).json({
          error: result.errorCode ?? 'client_validation_failed',
          message: result.message ?? 'Client origin validation failed.',
        });
        return;
      }

      (req as Request & { clientValidation?: ClientValidationResultDTO }).clientValidation = result;
      next();
    } catch (error: unknown) {
      res.status(500).json({
        error: 'internal_server_error',
        message:
          error instanceof Error
            ? error.message
            : 'An unexpected error occurred during client authorization',
      });
    }
  };
}
