import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminPage } from './AdminPage';
import { useAuthStore } from '../stores/authStore';
import { createMockUser } from '../__tests__/mockData';

// Mock child components
vi.mock('../components/layout/Navbar', () => ({
  Navbar: () => <nav data-testid="navbar">Navbar</nav>,
}));

vi.mock('../components/admin/RegistrationRequests', () => ({
  RegistrationRequests: () => (
    <div data-testid="registration-requests">Registration Requests Component</div>
  ),
}));

vi.mock('../components/admin/UsersTab', () => ({
  UsersTab: () => <div data-testid="users-tab">Users Tab Component</div>,
}));

describe('AdminPage', () => {
  const mockLogout = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: createMockUser({ email: 'admin@example.com', is_admin: true, role: 'admin' }),
      logout: mockLogout,
    });
  });

  const renderAdminPage = () => {
    return render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    );
  };

  it('should render Navbar', () => {
    renderAdminPage();
    expect(screen.getByTestId('navbar')).toBeInTheDocument();
  });

  it('should render Users tab by default', () => {
    renderAdminPage();
    expect(screen.getByTestId('users-tab')).toBeInTheDocument();
  });

  it('should switch to Registration Requests tab', () => {
    renderAdminPage();
    fireEvent.click(screen.getByText('Registration Requests'));
    expect(screen.getByTestId('registration-requests')).toBeInTheDocument();
    expect(screen.queryByTestId('users-tab')).not.toBeInTheDocument();
  });

  it('should switch back to Users tab', () => {
    renderAdminPage();
    fireEvent.click(screen.getByText('Registration Requests'));
    fireEvent.click(screen.getByText('Users'));
    expect(screen.getByTestId('users-tab')).toBeInTheDocument();
  });

  it('should show Users and Registration Requests tabs', () => {
    renderAdminPage();
    expect(screen.getByText('Users')).toBeInTheDocument();
    expect(screen.getByText('Registration Requests')).toBeInTheDocument();
  });

  it('should not show Datasets or Projects tabs', () => {
    renderAdminPage();
    expect(screen.queryByText('Datasets')).not.toBeInTheDocument();
    expect(screen.queryByText('Projects')).not.toBeInTheDocument();
  });
});
