/**
 * Secondary Port (SPI) para operaciones de almacenamiento en caché.
 * Permite desacoplar el caso de uso de implementaciones concretas como Redis o memoria volátil.
 */
export interface CacheProviderPort {
  /**
   * Recupera un elemento almacenado en caché por su clave.
   * @param key Identificador único de la clave en caché.
   * @returns El valor deserializado o null si expiró o no existe.
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Almacena un elemento en caché con un tiempo de expiración opcional.
   * @param key Clave única de almacenamiento.
   * @param value Elemento a persistir en caché.
   * @param ttlSeconds Tiempo de vida en segundos antes de expirar.
   */
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;

  /**
   * Invalida o remueve un elemento de la caché.
   * @param key Clave a remover.
   */
  delete(key: string): Promise<void>;
}

