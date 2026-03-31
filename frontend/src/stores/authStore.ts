import { create } from 'zustand';
import { User } from '../api/types';
import * as authApi from '../api/auth';
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from '../api/tokenService';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isLoginLoading: boolean;
  error: string | null;

  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  isLoginLoading: false,
  error: null,

  login: async (email: string, password: string) => {
    set({ isLoginLoading: true, error: null });
    try {
      const tokens = await authApi.login({ email, password });
      setTokens(tokens.access_token, tokens.refresh_token);

      const user = await authApi.getCurrentUser();
      set({ user, isAuthenticated: true, isLoginLoading: false });
    } catch (error) {
      set({
        error: 'Invalid email or password',
        isLoginLoading: false,
      });
      throw error;
    }
  },

  logout: async () => {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      try {
        await authApi.logout(refreshToken);
      } catch {
        // Ignore errors during logout
      }
    }
    clearTokens();
    set({ user: null, isAuthenticated: false });
  },

  checkAuth: async () => {
    const token = getAccessToken();
    if (!token) {
      set({ isLoading: false, isAuthenticated: false });
      return;
    }

    try {
      const user = await authApi.getCurrentUser();
      set({ user, isAuthenticated: true, isLoading: false });
    } catch {
      clearTokens();
      set({ isAuthenticated: false, isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
