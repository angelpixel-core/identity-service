import { useState } from 'react';
import { AuthSession, UserProfile } from './contexts/identity/domain/types';
import { BoundedShell, PlatformNavTab, resolveSurfaceFromPath } from './shell/BoundedShell';
import { AuthPortalView } from './contexts/auth/ui/AuthPortalView';
import { TenantConsoleView } from './contexts/tenant/ui/TenantConsoleView';
import { PlatformConsoleView } from './contexts/platform/ui/PlatformConsoleView';

export function App() {
  const [platformTab, setPlatformTab] = useState<PlatformNavTab>('posture');
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
    let activeSession = session;
    try {
      const latestStored = localStorage.getItem('identity_session');
      if (latestStored) {
        activeSession = JSON.parse(latestStored) as AuthSession;
      }
    } catch {
      throw new Error('Invalid identity_session in localStorage');
    }

    if (!activeSession) {
      throw new Error('No active session');
    }

    const response = await fetch('/api/v1/auth/me', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${activeSession.token}`,
        'x-tenant-id': activeSession.tenantId,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to fetch profile');
    }

    return data;
  };

  const activePath =
    typeof window !== 'undefined' ? window.location.pathname : '/auth';
  const surface = resolveSurfaceFromPath(activePath);

  return (
    <BoundedShell
      session={session}
      activePlatformTab={platformTab}
      onPlatformTabChange={setPlatformTab}
    >
      {session && surface === 'platform' ? (
        <PlatformConsoleView
          session={session}
          activeTab={platformTab}
          onTabChange={setPlatformTab}
        />
      ) : session && surface === 'tenant' ? (
        <TenantConsoleView session={session} />
      ) : (
        <AuthPortalView
          session={session}
          onSessionChange={handleRegisterSuccess}
          onLogout={handleLogout}
          fetchProfile={fetchProfile}
        />
      )}
    </BoundedShell>
  );
}
