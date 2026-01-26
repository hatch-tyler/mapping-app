import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { useAuthStore } from './stores/authStore';

// Mock all page components to avoid complex dependencies
vi.mock('./pages/LoginPage', () => ({
  LoginPage: () => <div data-testid="login-page">Login Page</div>,
}));

vi.mock('./pages/RegisterPage', () => ({
  RegisterPage: () => <div data-testid="register-page">Register Page</div>,
}));

vi.mock('./pages/ConfirmEmailPage', () => ({
  ConfirmEmailPage: () => <div data-testid="confirm-email-page">Confirm Email Page</div>,
}));

vi.mock('./pages/MapPage', () => ({
  MapPage: () => <div data-testid="map-page">Map Page</div>,
}));

vi.mock('./pages/AdminPage', () => ({
  AdminPage: () => <div data-testid="admin-page">Admin Page</div>,
}));

vi.mock('./pages/DataPage', () => ({
  DataPage: () => <div data-testid="data-page">Data Page</div>,
}));

// Mock ProtectedRoute to test routing
vi.mock('./components/auth/ProtectedRoute', () => ({
  ProtectedRoute: ({ children, requireAdmin }: { children: React.ReactNode; requireAdmin?: boolean }) => {
    const { user } = useAuthStore();
    if (!user) {
      return <div data-testid="redirect-login">Redirecting to login</div>;
    }
    if (requireAdmin && !user.is_admin) {
      return <div data-testid="redirect-home">Redirecting to home</div>;
    }
    return <>{children}</>;
  },
}));

describe('App', () => {
  const mockCheckAuth = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: null,
      isLoading: false,
      checkAuth: mockCheckAuth,
    });
    // Reset window location
    window.history.pushState({}, '', '/');
  });

  it('should show loading spinner when isLoading is true', () => {
    useAuthStore.setState({
      user: null,
      isLoading: true,
      checkAuth: mockCheckAuth,
    });

    render(<App />);
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('should call checkAuth on mount', () => {
    render(<App />);
    expect(mockCheckAuth).toHaveBeenCalled();
  });

  it('should render login page at /login route', async () => {
    window.history.pushState({}, '', '/login');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument();
    });
  });

  it('should render register page at /register route', async () => {
    window.history.pushState({}, '', '/register');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('register-page')).toBeInTheDocument();
    });
  });

  it('should render confirm email page at /confirm-email route', async () => {
    window.history.pushState({}, '', '/confirm-email');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('confirm-email-page')).toBeInTheDocument();
    });
  });

  it('should render data page at /data route', async () => {
    window.history.pushState({}, '', '/data');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('data-page')).toBeInTheDocument();
    });
  });

  it('should redirect to login for protected route when not authenticated', async () => {
    useAuthStore.setState({
      user: null,
      isLoading: false,
      checkAuth: mockCheckAuth,
    });
    window.history.pushState({}, '', '/');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('redirect-login')).toBeInTheDocument();
    });
  });

  it('should render map page for authenticated user', async () => {
    useAuthStore.setState({
      user: {
        id: '1',
        email: 'user@example.com',
        full_name: null,
        is_admin: false,
        is_active: true,
        created_at: new Date().toISOString(),
      },
      isLoading: false,
      checkAuth: mockCheckAuth,
    });
    window.history.pushState({}, '', '/');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('map-page')).toBeInTheDocument();
    });
  });

  it('should redirect non-admin from admin route', async () => {
    useAuthStore.setState({
      user: {
        id: '1',
        email: 'user@example.com',
        full_name: null,
        is_admin: false,
        is_active: true,
        created_at: new Date().toISOString(),
      },
      isLoading: false,
      checkAuth: mockCheckAuth,
    });
    window.history.pushState({}, '', '/admin');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('redirect-home')).toBeInTheDocument();
    });
  });

  it('should render admin page for admin user', async () => {
    useAuthStore.setState({
      user: {
        id: '1',
        email: 'admin@example.com',
        full_name: 'Admin User',
        is_admin: true,
        is_active: true,
        created_at: new Date().toISOString(),
      },
      isLoading: false,
      checkAuth: mockCheckAuth,
    });
    window.history.pushState({}, '', '/admin');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('admin-page')).toBeInTheDocument();
    });
  });

  it('should redirect unknown routes to home', async () => {
    useAuthStore.setState({
      user: null,
      isLoading: false,
      checkAuth: mockCheckAuth,
    });
    window.history.pushState({}, '', '/unknown-route');
    render(<App />);

    await waitFor(() => {
      // Should redirect to / which requires auth, so it redirects to login
      expect(screen.getByTestId('redirect-login')).toBeInTheDocument();
    });
  });
});
