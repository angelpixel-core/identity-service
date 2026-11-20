import { useState } from 'react';
import { AuthSession, UserProfile } from './contexts/identity/domain/types';
import { BoundedShell } from './shell/BoundedShell';
import { AuthPortalView } from './contexts/auth/ui/AuthPortalView';

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
      <AuthPortalView
        session={session}
        onSessionChange={handleRegisterSuccess}
        onLogout={handleLogout}
        fetchProfile={fetchProfile}
      />
    </BoundedShell>
  );
}
