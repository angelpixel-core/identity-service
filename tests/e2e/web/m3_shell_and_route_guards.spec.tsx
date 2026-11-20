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
});
