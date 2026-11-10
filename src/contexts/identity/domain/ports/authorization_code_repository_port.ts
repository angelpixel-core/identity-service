import { AuthorizationCode } from '../entities/authorization_code/entity';

/**
 * Secondary Port (SPI): AuthorizationCodeRepositoryPort
 * Abstracción de persistencia para el almacenamiento y recuperación de códigos de autorización OAuth2 efímeros.
 */
export interface AuthorizationCodeRepositoryPort {
  /**
   * Persiste un código de autorización nuevo o actualizado (ej. tras ser consumido).
   */
  save(authorizationCode: AuthorizationCode): Promise<void>;

  /**
   * Busca un código de autorización por su valor único de clave.
   */
  findByCode(code: string): Promise<AuthorizationCode | null>;

  /**
   * Elimina de forma idempotente los códigos expirados para evitar crecimiento descontrolado de almacenamiento.
   */
  deleteExpired(now?: Date): Promise<void>;
}

