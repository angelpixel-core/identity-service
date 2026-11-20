import { useState } from 'react';
import { RegisterForm } from './contexts/identity/ui/components/register_form';
import { UserProfileCard } from './contexts/identity/ui/components/user_profile_card';
import { AuthSession, UserProfile } from './contexts/identity/domain/types';
import { BoundedShell } from './shell/BoundedShell';
import { M3Button } from './design-system/components/M3Primitives';

export function App() {
  const [session, setSession] = useState<AuthSession | null>(() => {
    const stored = localStorage.getItem('identity_session');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return null;
      }
    }
    return null;
  });

  const handleRegisterSuccess = (newSession: AuthSession) => {
    setSession(newSession);
    localStorage.setItem('identity_session', JSON.stringify(newSession));
  };

  const handleLogout = () => {
    setSession(null);
    localStorage.removeItem('identity_session');
  };

  const fetchProfile = async (): Promise<UserProfile> => {
    if (!session) {
      throw new Error('No active session');
    }

    const response = await fetch('/api/v1/auth/me', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'x-tenant-id': session.tenantId,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to fetch profile');
    }

    return data;
  };

  return (
    <BoundedShell session={session}>
      {session ? (
        <div>
          <div className="session-toolbar">
            <span>
              Conectado como: <strong>{session.email}</strong> ({session.tenantId})
            </span>
            <M3Button variant="outlined" onClick={handleLogout}>
              Cerrar Sesión
            </M3Button>
          </div>
          <UserProfileCard fetchProfile={fetchProfile} />
        </div>
      ) : (
        <div>
          <h2 className="m3-section-title">Registro de Nuevo Usuario</h2>
          <RegisterForm
            defaultTenantId="acme-corp"
            onSuccess={handleRegisterSuccess}
          />
        </div>
      )}
    </BoundedShell>
  );
}
