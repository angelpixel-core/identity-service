import { CacheProviderPort } from '../../../../src/contexts/identity/application/ports/cache/cache_provider';
import { MemoryCacheAdapter } from '../../../../src/contexts/identity/infrastructure/cache/memory_cache_adapter';

describe('Infrastructure Adapter: MemoryCacheAdapter', () => {
  let cacheAdapter: CacheProviderPort;

  beforeEach(() => {
    jest.useFakeTimers();
    cacheAdapter = new MemoryCacheAdapter();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Basic Storage and Retrieval (set & get)', () => {
    it('should store and retrieve typed values by key', async () => {
      const data = { userId: '123', name: 'Alice', active: true };
      await cacheAdapter.set('user:123', data);

      const retrieved = await cacheAdapter.get<typeof data>('user:123');
      expect(retrieved).toEqual(data);
    });

    it('should return null when key does not exist in cache', async () => {
      const retrieved = await cacheAdapter.get('non-existent-key');
      expect(retrieved).toBeNull();
    });

    it('should overwrite existing value when setting the same key again', async () => {
      await cacheAdapter.set('session:1', 'initial-token');
      await cacheAdapter.set('session:1', 'refreshed-token');

      const retrieved = await cacheAdapter.get<string>('session:1');
      expect(retrieved).toBe('refreshed-token');
    });
  });

  describe('TTL Expiration', () => {
    it('should return the value when accessed within TTL window', async () => {
      await cacheAdapter.set('temp:profile', { status: 'cached' }, 60);

      // Advance by 30 seconds (still valid)
      jest.advanceTimersByTime(30 * 1000);

      const retrieved = await cacheAdapter.get('temp:profile');
      expect(retrieved).toEqual({ status: 'cached' });
    });

    it('should return null and purge item after TTL has expired', async () => {
      await cacheAdapter.set('temp:token', 'secret', 5); // 5 seconds TTL

      // Advance past expiration (6 seconds)
      jest.advanceTimersByTime(6 * 1000);

      const retrieved = await cacheAdapter.get('temp:token');
      expect(retrieved).toBeNull();
    });
  });

  describe('Key Invalidation (delete)', () => {
    it('should remove existing entry from cache and subsequent get should return null', async () => {
      await cacheAdapter.set('item:to-remove', 'value-to-delete');
      await cacheAdapter.delete('item:to-remove');

      const retrieved = await cacheAdapter.get('item:to-remove');
      expect(retrieved).toBeNull();
    });

    it('should execute delete without error even if key does not exist', async () => {
      await expect(cacheAdapter.delete('non-existent-key')).resolves.not.toThrow();
    });
  });
});

