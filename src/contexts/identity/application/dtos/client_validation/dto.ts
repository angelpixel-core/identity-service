import { ClientType } from '../../../domain/entities/client_application/aggregate';

export type ClientValidationErrorCode =
  | 'missing_client_id'
  | 'invalid_client_id'
  | 'client_not_found'
  | 'client_deactivated'
  | 'unauthorized_client_origin';

/**
 * Snapshot sanitizado de una aplicación cliente registrada para almacenamiento en caché (Cache-Aside).
 * Excluye rigurosamente `clientSecretHash` para evitar persistir secretos en memoria volátil o Redis.
 */
export interface CachedRegisteredClientDTO {
  readonly id: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly clientType: ClientType;
  readonly allowedOrigins: string[];
  readonly redirectUris: string[];
  readonly allowedGrantTypes: string[];
  readonly scopes: string[];
  readonly isActive: boolean;
}

/**
 * DTO de salida que representa el resultado de la validación de una aplicación cliente y su origen (CORS / Redirect URI).
 */
export interface ClientValidationResultDTO {
  readonly authorized: boolean;
  readonly clientId: string;
  readonly clientName?: string;
  readonly clientType?: ClientType;
  readonly allowedOrigins?: string[];
  readonly redirectUris?: string[];
  readonly allowedGrantTypes?: string[];
  readonly scopes?: string[];
  readonly errorCode?: ClientValidationErrorCode;
  readonly message?: string;
}

