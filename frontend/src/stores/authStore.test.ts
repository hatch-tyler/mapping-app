import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from './authStore';
import * as authApi from '../api/auth';

// Mock the auth API module
vi.mock('../api/auth', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
}));

describe('authStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: true,
      isLoginLoading: false,
      error: null,
    });
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = useAuthStore.getState();

      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(true);
      expect(state.isLoginLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe('login', () => {
    it('should login successfully and store tokens', async () => {
      const mockTokens = {
        access_token: 'access-token-123',
        refresh_token: 'refresh-token-456',
        token_type: 'bearer',
      };
      const mockUser = {
        id: '1',
        email: 'test@example.com',
        is_admin: false,
        created_at: new Date().toISOString(),
      };

      vi.mocked(authApi.login).mockResolvedValue(mockTokens);
      vi.mocked(authApi.getCurrentUser).mockResolvedValue(mockUser);

      await useAuthStore.getState().login('test@example.com', 'password123');

      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.isAuthenticated).toBe(true);
      // Note: login() uses isLoginLoading, not isLoading
      // isLoading is for initial auth check only
      expect(state.isLoginLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(localStorage.getItem('access_token')).toBe('access-token-123');
      expect(localStorage.getItem('refresh_token')).toBe('refresh-token-456');
    });

    it('should handle login failure', async () => {
      vi.mocked(authApi.login).mockRejectedValue(new Error('Invalid credentials'));

      await expect(
        useAuthStore.getState().login('test@example.com', 'wrongpassword')
      ).rejects.toThrow();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      // Note: login() uses isLoginLoading, not isLoading
      expect(state.isLoginLoading).toBe(false);
      expect(state.error).toBe('Invalid email or password');
    });

    it('should set isLoginLoading state during login', async () => {
      vi.mocked(authApi.login).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      const loginPromise = useAuthStore.getState().login('test@example.com', 'password');

      // Check isLoginLoading state is true during login (not isLoading)
      // isLoading is for initial auth check, isLoginLoading is for login action
      expect(useAuthStore.getState().isLoginLoading).toBe(true);
      // isLoading should remain unchanged during login
      expect(useAuthStore.getState().isLoading).toBe(true);

      // Wait and handle rejection
      try {
        await loginPromise;
      } catch {
        // Expected to fail since mock doesn't return proper data
      }
    });

    it('should reset isLoginLoading on successful login', async () => {
      const mockTokens = {
        access_token: 'access-token-123',
        refresh_token: 'refresh-token-456',
        token_type: 'bearer',
      };
      const mockUser = {
        id: '1',
        email: 'test@example.com',
        is_admin: false,
        created_at: new Date().toISOString(),
      };

      vi.mocked(authApi.login).mockResolvedValue(mockTokens);
      vi.mocked(authApi.getCurrentUser).mockResolvedValue(mockUser);

      await useAuthStore.getState().login('test@example.com', 'password123');

      const state = useAuthStore.getState();
      expect(state.isLoginLoading).toBe(false);
    });

    it('should reset isLoginLoading on login failure', async () => {
      vi.mocked(authApi.login).mockRejectedValue(new Error('Invalid credentials'));

      await expect(
        useAuthStore.getState().login('test@example.com', 'wrongpassword')
      ).rejects.toThrow();

      const state = useAuthStore.getState();
      expect(state.isLoginLoading).toBe(false);
    });
  });

  describe('logout', () => {
    it('should logout and clear tokens', async () => {
      // Set up authenticated state
      localStorage.setItem('access_token', 'token-123');
      localStorage.setItem('refresh_token', 'refresh-123');
      useAuthStore.setState({
        user: { id: '1', email: 'test@example.com', is_admin: false, created_at: '' },
        isAuthenticated: true,
        isLoading: false,
      });

      vi.mocked(authApi.logout).mockResolvedValue(undefined);

      await useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(localStorage.getItem('access_token')).toBeNull();
      expect(localStorage.getItem('refresh_token')).toBeNull();
    });

    it('should clear state even if API logout fails', async () => {
      localStorage.setItem('access_token', 'token-123');
      localStorage.setItem('refresh_token', 'refresh-123');
      useAuthStore.setState({
        user: { id: '1', email: 'test@example.com', is_admin: false, created_at: '' },
        isAuthenticated: true,
      });

      vi.mocked(authApi.logout).mockRejectedValue(new Error('Network error'));

      await useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });

    it('should handle logout without refresh token', async () => {
      useAuthStore.setState({
        user: { id: '1', email: 'test@example.com', is_admin: false, created_at: '' },
        isAuthenticated: true,
      });

      await useAuthStore.getState().logout();

      expect(authApi.logout).not.toHaveBeenCalled();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });

  describe('checkAuth', () => {
    it('should authenticate when valid token exists', async () => {
      localStorage.setItem('access_token', 'valid-token');
      const mockUser = {
        id: '1',
        email: 'test@example.com',
        is_admin: true,
        created_at: new Date().toISOString(),
      };

      vi.mocked(authApi.getCurrentUser).mockResolvedValue(mockUser);

      await useAuthStore.getState().checkAuth();

      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
    });

    it('should set unauthenticated when no token exists', async () => {
      await useAuthStore.getState().checkAuth();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
      expect(authApi.getCurrentUser).not.toHaveBeenCalled();
    });

    it('should clear tokens when getCurrentUser fails', async () => {
      localStorage.setItem('access_token', 'expired-token');
      localStorage.setItem('refresh_token', 'refresh-token');

      vi.mocked(authApi.getCurrentUser).mockRejectedValue(new Error('Unauthorized'));

      await useAuthStore.getState().checkAuth();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
      expect(localStorage.getItem('access_token')).toBeNull();
      expect(localStorage.getItem('refresh_token')).toBeNull();
    });
  });

  describe('clearError', () => {
    it('should clear error message', () => {
      useAuthStore.setState({ error: 'Some error message' });

      useAuthStore.getState().clearError();

      expect(useAuthStore.getState().error).toBeNull();
    });
  });
});
