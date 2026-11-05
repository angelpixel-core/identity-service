import { useState } from 'react';
import { RegisterForm } from './contexts/identity/ui/components/register_form';
import { UserProfileCard } from './contexts/identity/ui/components/user_profile_card';
import { AuthSession, UserProfile } from './contexts/identity/domain/types';

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
    <main className="portal-container">
      <header className="portal-header">
        <h1>Identity Service Portal</h1>
        <p>Multi-Tenant SaaS User Registration & Profile Management</p>
      </header>

      <div className="portal-card">
        {session ? (
          <div>
            <div className="session-toolbar">
              <span>
                Conectado como: <strong>{session.email}</strong> ({session.tenantId})
              </span>
              <button type="button" className="btn-secondary" onClick={handleLogout}>
                Cerrar Sesión
              </button>
            </div>
            <UserProfileCard fetchProfile={fetchProfile} />
          </div>
        ) : (
          <div>
            <h2 style={{ marginBottom: '1.25rem' }}>Registro de Nuevo Usuario</h2>
            <RegisterForm
              defaultTenantId="acme-corp"
              onSuccess={handleRegisterSuccess}
            />
          </div>
        )}
      </div>
    </main>
  );
}
