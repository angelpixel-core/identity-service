/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RegisterForm } from '../../../interfaces/web/client/contexts/identity/ui/components/register_form';

describe('Web UI Component: RegisterForm (E2E / Integration)', () => {
  let mockApiClient: {
    register: jest.Mock;
  };

  beforeEach(() => {
    mockApiClient = {
      register: jest.fn(),
    };
  });

  it('should render all form fields and submit button', () => {
    render(<RegisterForm apiClient={mockApiClient as any} />);

    expect(screen.getByLabelText(/tenant/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /register|create account/i })).toBeInTheDocument();
  });

  it('should display validation error when password is shorter than 8 characters', async () => {
    render(<RegisterForm apiClient={mockApiClient as any} />);

    fireEvent.change(screen.getByLabelText(/tenant/i), { target: { value: 'acme-corp' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@acme.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /register|create account/i }));

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(mockApiClient.register).not.toHaveBeenCalled();
  });

  it('should successfully submit valid credentials and trigger onSuccess callback', async () => {
    const handleSuccess = jest.fn();
    mockApiClient.register.mockResolvedValueOnce({
      token: 'jwt-mock-token-xyz',
      userId: 'user-123',
      email: 'user@acme.com',
      tenantId: 'acme-corp',
    });

    render(<RegisterForm apiClient={mockApiClient as any} onSuccess={handleSuccess} />);

    fireEvent.change(screen.getByLabelText(/tenant/i), { target: { value: 'acme-corp' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@acme.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'ValidPass123!' } });
    fireEvent.click(screen.getByRole('button', { name: /register|create account/i }));

    await waitFor(() => {
      expect(mockApiClient.register).toHaveBeenCalledWith({
        tenantId: 'acme-corp',
        email: 'user@acme.com',
        password: 'ValidPass123!',
      });
      expect(handleSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'jwt-mock-token-xyz',
          userId: 'user-123',
        })
      );
    });
  });

  it('should display server error message when registration fails with conflict', async () => {
    mockApiClient.register.mockRejectedValueOnce(
      new Error('User with email "user@acme.com" already exists in tenant "acme-corp"')
    );

    render(<RegisterForm apiClient={mockApiClient as any} />);

    fireEvent.change(screen.getByLabelText(/tenant/i), { target: { value: 'acme-corp' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@acme.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'ValidPass123!' } });
    fireEvent.click(screen.getByRole('button', { name: /register|create account/i }));

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
  });
});