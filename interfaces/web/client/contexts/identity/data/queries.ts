import { useState, useEffect, useCallback } from 'react';
import { UserProfile } from '../domain/types';

export interface UseUserProfileResult {
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// Caché en memoria para clientes SPA (estrategia de lectura optimista y rápida)
const clientProfileCache = new Map<string, { data: UserProfile; timestamp: number }>();

/**
 * Custom Hook useUserProfile:
 * Orquesta la recuperación de perfil con soporte de caché del lado del cliente.
 */
export function useUserProfile(
  fetchProfile: () => Promise<UserProfile>,
  cacheKey?: string,
  cacheTtlMs: number = 300000
): UseUserProfileResult {
  const [profile, setProfile] = useState<UserProfile | null>(() => {
    if (cacheKey && clientProfileCache.has(cacheKey)) {
      const cached = clientProfileCache.get(cacheKey)!;
      if (Date.now() - cached.timestamp < cacheTtlMs) {
        return cached.data;
      }
    }
    return null;
  });

  const [loading, setLoading] = useState<boolean>(!profile);
  const [error, setError] = useState<string | null>(null);

  const executeFetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProfile();
      setProfile(data);
      if (cacheKey) {
        clientProfileCache.set(cacheKey, { data, timestamp: Date.now() });
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [fetchProfile, cacheKey]);

  useEffect(() => {
    if (!profile) {
      executeFetch();
    }
  }, [executeFetch, profile]);

  return {
    profile,
    loading,
    error,
    refetch: executeFetch,
  };
}

