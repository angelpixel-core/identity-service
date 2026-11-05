/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { UserProfileCard } from '../../../interfaces/web/client/contexts/identity/ui/components/user_profile_card';

describe('Web UI Component: UserProfileCard (E2E / Component Spec)', () => {
  let mockFetchProfile: jest.Mock;

  const validProfile = {
    id: 'user-uuid-1001',
    email: 'alice@acme.com',
    tenantId: 'acme-corp',
    createdAt: new Date('2026-11-04T12:00:00.000Z'),
    updatedAt: new Date('2026-11-04T12:00:00.000Z'),
  };

  beforeEach(() => {
    mockFetchProfile = jest.fn();
  });

  it('should display loading state while profile data is being retrieved', () => {
    mockFetchProfile.mockReturnValue(new Promise(() => {})); // Never resolves to keep loading

    render(<UserProfileCard fetchProfile={mockFetchProfile} />);

    expect(screen.getByText(/loading profile/i)).toBeInTheDocument();
  });

  it('should render user profile details and tenant information on successful load', async () => {
    mockFetchProfile.mockResolvedValueOnce(validProfile);

    render(<UserProfileCard fetchProfile={mockFetchProfile} />);

    await waitFor(() => {
      expect(screen.getByText('alice@acme.com')).toBeInTheDocument();
      expect(screen.getByText(/acme-corp/i)).toBeInTheDocument();
      expect(screen.getByText(/user-uuid-1001/i)).toBeInTheDocument();
    });

    // Ensure sensitive fields like passwordHash are never rendered
    expect(screen.queryByText(/password/i)).not.toBeInTheDocument();
  });

  it('should display error message when profile retrieval fails', async () => {
    mockFetchProfile.mockRejectedValueOnce(new Error('Unauthorized: Session expired'));

    render(<UserProfileCard fetchProfile={mockFetchProfile} />);

    expect(await screen.findByText(/unauthorized: session expired/i)).toBeInTheDocument();
  });

  it('should allow retrying fetch when reload button is clicked', async () => {
    mockFetchProfile
      .mockRejectedValueOnce(new Error('Network connection error'))
      .mockResolvedValueOnce(validProfile);

    render(<UserProfileCard fetchProfile={mockFetchProfile} />);

    expect(await screen.findByText(/network connection error/i)).toBeInTheDocument();

    const retryButton = screen.getByRole('button', { name: /retry|reload/i });
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(screen.getByText('alice@acme.com')).toBeInTheDocument();
    });

    expect(mockFetchProfile).toHaveBeenCalledTimes(2);
  });
});

