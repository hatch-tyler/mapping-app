import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import { useAuthStore } from '../../stores/authStore';
import { createMockUser } from '../../__tests__/mockData';

// Mock react-router-dom Navigate
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    Navigate: vi.fn(({ to }) => <div data-testid="navigate" data-to={to}>Navigate to {to}</div>),
  };
});

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show loading spinner when isLoading is true', () => {
    useAuthStore.setState({
      isLoading: true,
      isAuthenticated: false,
      user: null,
    });

    render(
      <MemoryRouter>
        <ProtectedRoute>
          <div>Protected Content</div>
        </ProtectedRoute>
      </MemoryRouter>
    );

    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('should redirect to login when not authenticated', () => {
    useAuthStore.setState({
      isLoading: false,
      isAuthenticated: false,
      user: null,
    });

    render(
      <MemoryRouter>
        <ProtectedRoute>
          <div>Protected Content</div>
        </ProtectedRoute>
      </MemoryRouter>
    );

    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/login');
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('should render children when authenticated', () => {
    useAuthStore.setState({
      isLoading: false,
      isAuthenticated: true,
      user: createMockUser({ is_admin: false }),
    });

    render(
      <MemoryRouter>
        <ProtectedRoute>
          <div>Protected Content</div>
        </ProtectedRoute>
      </MemoryRouter>
    );

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
    expect(screen.queryByTestId('navigate')).not.toBeInTheDocument();
  });

  it('should redirect to home when requireAdmin is true and user is not admin', () => {
    useAuthStore.setState({
      isLoading: false,
      isAuthenticated: true,
      user: createMockUser({ is_admin: false }),
    });

    render(
      <MemoryRouter>
        <ProtectedRoute requireAdmin>
          <div>Admin Content</div>
        </ProtectedRoute>
      </MemoryRouter>
    );

    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/');
    expect(screen.queryByText('Admin Content')).not.toBeInTheDocument();
  });

  it('should render children when requireAdmin is true and user is admin', () => {
    useAuthStore.setState({
      isLoading: false,
      isAuthenticated: true,
      user: createMockUser({ is_admin: true }),
    });

    render(
      <MemoryRouter>
        <ProtectedRoute requireAdmin>
          <div>Admin Content</div>
        </ProtectedRoute>
      </MemoryRouter>
    );

    expect(screen.getByText('Admin Content')).toBeInTheDocument();
    expect(screen.queryByTestId('navigate')).not.toBeInTheDocument();
  });

  it('should render children when requireAdmin is false and user is not admin', () => {
    useAuthStore.setState({
      isLoading: false,
      isAuthenticated: true,
      user: createMockUser({ is_admin: false }),
    });

    render(
      <MemoryRouter>
        <ProtectedRoute requireAdmin={false}>
          <div>Regular Content</div>
        </ProtectedRoute>
      </MemoryRouter>
    );

    expect(screen.getByText('Regular Content')).toBeInTheDocument();
  });
});
