import { useState, useEffect, useCallback } from 'react';
import { AuthSession, UserProfile } from '../../domain/types';

export interface UserProfileCardProps {
  fetchProfile: () => Promise<UserProfile>;
  initialProfile?: UserProfile;
  session?: Partial<AuthSession>;
}

function formatProviderLabel(provider?: string): string | null {
  if (provider === 'google') return 'Google OIDC';
  if (provider === 'microsoft') return 'Microsoft Entra ID';
  if (provider === 'local') return 'Local';
  return null;
}

/**
 * Componente visual de tarjeta de perfil de usuario contextualizada por Tenant.
 * Muestra información del usuario activo, identificador de organización y estados de carga/error.
 */
export function UserProfileCard({ fetchProfile, initialProfile, session }: UserProfileCardProps) {
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

  const displayName = profile.name ?? session?.name;
  const avatarUrl = profile.picture ?? session?.picture;
  const providerLabel = formatProviderLabel(profile.provider ?? session?.provider);
  const roles = profile.roles ?? session?.roles;

  return (
    <article className="user-profile-card">
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName || profile.email}
              referrerPolicy="no-referrer"
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '999px',
                objectFit: 'cover',
              }}
            />
          ) : displayName ? (
            <div
              aria-hidden="true"
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '999px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 600,
                background: 'var(--md-sys-color-primary-container, #d3e3fd)',
                color: 'var(--md-sys-color-on-primary-container, #041e49)',
              }}
            >
              {displayName.slice(0, 1).toUpperCase()}
            </div>
          ) : null}
          <div>
            <h2 style={{ margin: 0 }}>{displayName || 'User Profile'}</h2>
            {displayName && (
              <span style={{ fontSize: '0.85rem', opacity: 0.75 }}>{profile.email}</span>
            )}
          </div>
        </div>
        <span className="badge-tenant">Tenant: {profile.tenantId}</span>
      </header>
      <section className="profile-details">
        <dl>
          {displayName && (
            <div>
              <dt>Name:</dt>
              <dd>{displayName}</dd>
            </div>
          )}
          <div>
            <dt>User ID:</dt>
            <dd>{profile.id || profile.userId}</dd>
          </div>
          <div>
            <dt>Email:</dt>
            <dd>{profile.email}</dd>
          </div>
          {providerLabel && (
            <div>
              <dt>Provider:</dt>
              <dd>{providerLabel}</dd>
            </div>
          )}
          {roles && roles.length > 0 && (
            <div>
              <dt>Roles:</dt>
              <dd>{roles.join(', ')}</dd>
            </div>
          )}
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

