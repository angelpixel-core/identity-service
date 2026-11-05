import { useState, useEffect, useCallback } from 'react';
import { UserProfile } from '../../domain/types';

export interface UserProfileCardProps {
  fetchProfile: () => Promise<UserProfile>;
  initialProfile?: UserProfile;
}

/**
 * Componente visual de tarjeta de perfil de usuario contextualizada por Tenant.
 * Muestra información del usuario activo, identificador de organización y estados de carga/error.
 */
export function UserProfileCard({ fetchProfile, initialProfile }: UserProfileCardProps) {
  const [profile, setProfile] = useState<UserProfile | null>(initialProfile ?? null);
  const [loading, setLoading] = useState<boolean>(!initialProfile);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProfile();
      setProfile(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [fetchProfile]);

  useEffect(() => {
    if (!initialProfile) {
      loadData();
    }
  }, [loadData, initialProfile]);

  if (loading) {
    return (
      <div role="status" aria-live="polite" className="user-profile-loading">
        <p>Loading profile...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="user-profile-error">
        <p>{error}</p>
        <button type="button" onClick={loadData}>
          Retry
        </button>
      </div>
    );
  }

  if (!profile) {
    return null;
  }

  return (
    <article className="user-profile-card">
      <header>
        <h2>User Profile</h2>
        <span className="badge-tenant">Tenant: {profile.tenantId}</span>
      </header>
      <section className="profile-details">
        <dl>
          <div>
            <dt>User ID:</dt>
            <dd>{profile.id || profile.userId}</dd>
          </div>
          <div>
            <dt>Email:</dt>
            <dd>{profile.email}</dd>
          </div>
          {profile.createdAt && (
            <div>
              <dt>Member Since:</dt>
              <dd>{new Date(profile.createdAt).toLocaleDateString()}</dd>
            </div>
          )}
        </dl>
      </section>
      <footer>
        <button type="button" onClick={loadData}>
          Reload
        </button>
      </footer>
    </article>
  );
}

