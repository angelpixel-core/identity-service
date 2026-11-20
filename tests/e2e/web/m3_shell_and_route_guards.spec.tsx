/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { App } from '../../../interfaces/web/client/App';

describe('Web UI E2E Spec: US-23 Material Design 3 Shell & Bounded Contexts', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('Scenario 1: renders centered Material Design 3 /auth surface for unauthenticated users without exposing /tenant or /platform navigation', () => {
    window.history.pushState({}, '', '/auth');

    render(<App />);

    expect(screen.getByTestId('auth-surface')).toBeInTheDocument();
    expect(screen.getByTestId('auth-card')).toBeInTheDocument();
    expect(screen.getByText('Identity Service Portal')).toBeInTheDocument();
    expect(screen.getByText('Registro de Nuevo Usuario')).toBeInTheDocument();

    // Must not expose /tenant or /platform navigation links when unauthenticated
    expect(screen.queryByRole('link', { name: /tenant/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /platform/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('tenant-surface')).not.toBeInTheDocument();
    expect(screen.queryByTestId('platform-surface')).not.toBeInTheDocument();
  });

  it('Scenario 2: blocks /platform with 403 Forbidden M3 banner for commercial tenant users (acme-corp)', () => {
    localStorage.setItem(
      'identity_session',
      JSON.stringify({
        token: 'mock-commercial-jwt',
        userId: 'usr_acme_01',
        email: 'member@acme-corp.com',
        tenantId: 'acme-corp',
        roles: ['member'],
      })
    );
    window.history.pushState({}, '', '/platform');

    render(<App />);

    const deniedBanner = screen.getByTestId('platform-access-denied');
    expect(deniedBanner).toBeInTheDocument();
    expect(deniedBanner).toHaveTextContent(/403 Forbidden/i);
    expect(deniedBanner).toHaveTextContent(/system:superadmin/i);
    expect(screen.queryByTestId('platform-surface')).not.toBeInTheDocument();
  });
});
