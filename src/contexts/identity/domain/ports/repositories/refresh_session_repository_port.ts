import { RefreshSession } from '../../entities/refresh_session/aggregate';

/**
 * Secondary Port (SPI): RefreshSessionRepositoryPort
 * Contrato de persistencia para el agregado RefreshSession.
 */
export interface RefreshSessionRepositoryPort {
  /**
   * Guarda o actualiza una sesión de refresco.
   */
  save(session: RefreshSession): Promise<void>;

  /**
   * Busca una sesión por el hash SHA-256 de su refresh token.
   */
  findByTokenHash(tokenHash: string): Promise<RefreshSession | null>;

  /**
   * Recupera todas las sesiones pertenecientes a una familia generacional.
   */
  findByFamilyId(familyId: string): Promise<RefreshSession[]>;

  /**
   * Revoca inmediatamente todas las sesiones asociadas a una familia.
   */
  revokeFamily(familyId: string, reason: string): Promise<void>;

  /**
   * Elimina sesiones expiradas de la persistencia (mantenimiento y recolección de basura).
   */
  deleteExpired(): Promise<number>;

  /**
   * Limpia todas las sesiones almacenadas (utilidad de testing).
   */
  clear(): Promise<void>;
}

