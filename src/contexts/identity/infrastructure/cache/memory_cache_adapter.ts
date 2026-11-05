import { CacheProviderPort } from '../../application/ports/cache/cache_provider';

interface CacheEntry<T> {
  value: T;
  expiresAt?: number;
}

/**
 * Adaptador de infraestructura en memoria que implementa CacheProviderPort.
 * Diseñado para entornos de prueba, ejecución sin dependencias externas y
 * caché L1 local en tiempo de ejecución.
 */
export class MemoryCacheAdapter implements CacheProviderPort {
  private readonly storage: Map<string, CacheEntry<unknown>> = new Map();

  public async get<T>(key: string): Promise<T | null> {
    const entry = this.storage.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.storage.delete(key);
      return null;
    }

    return entry.value as T;
  }

  public async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds !== undefined ? Date.now() + ttlSeconds * 1000 : undefined;
    this.storage.set(key, { value, expiresAt });
  }

  public async delete(key: string): Promise<void> {
    this.storage.delete(key);
  }

  /**
   * Limpia todas las entradas de la caché (método utilitario para testing).
   */
  public async clear(): Promise<void> {
    this.storage.clear();
  }
}

