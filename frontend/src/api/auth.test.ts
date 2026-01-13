import { describe, it, expect, vi, beforeEach } from 'vitest';
import { login, logout, refreshToken, getCurrentUser } from './auth';
import { apiClient } from './client';

// Mock the apiClient
vi.mock('./client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe('auth API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('login', () => {
    it('should send login request and return tokens', async () => {
      const mockTokens = {
        access_token: 'access-123',
        refresh_token: 'refresh-456',
        token_type: 'bearer',
      };
      vi.mocked(apiClient.post).mockResolvedValue({ data: mockTokens });

      const result = await login({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(apiClient.post).toHaveBeenCalledWith('/auth/login', {
        email: 'test@example.com',
        password: 'password123',
      });
      expect(result).toEqual(mockTokens);
    });

    it('should propagate errors on failed login', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Invalid credentials'));

      await expect(
        login({ email: 'test@example.com', password: 'wrong' })
      ).rejects.toThrow('Invalid credentials');
    });
  });

  describe('logout', () => {
    it('should send logout request with refresh token', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({});

      await logout('refresh-token-123');

      expect(apiClient.post).toHaveBeenCalledWith('/auth/logout', {
        refresh_token: 'refresh-token-123',
      });
    });

    it('should propagate errors on failed logout', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Token invalid'));

      await expect(logout('invalid-token')).rejects.toThrow('Token invalid');
    });
  });

  describe('refreshToken', () => {
    it('should send refresh request and return new tokens', async () => {
      const mockTokens = {
        access_token: 'new-access-123',
        refresh_token: 'new-refresh-456',
        token_type: 'bearer',
      };
      vi.mocked(apiClient.post).mockResolvedValue({ data: mockTokens });

      const result = await refreshToken('old-refresh-token');

      expect(apiClient.post).toHaveBeenCalledWith('/auth/refresh', {
        refresh_token: 'old-refresh-token',
      });
      expect(result).toEqual(mockTokens);
    });

    it('should propagate errors on failed refresh', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Refresh token expired'));

      await expect(refreshToken('expired-token')).rejects.toThrow('Refresh token expired');
    });
  });

  describe('getCurrentUser', () => {
    it('should fetch current user', async () => {
      const mockUser = {
        id: '1',
        email: 'test@example.com',
        is_admin: false,
        created_at: '2024-01-01T00:00:00Z',
      };
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockUser });

      const result = await getCurrentUser();

      expect(apiClient.get).toHaveBeenCalledWith('/users/me');
      expect(result).toEqual(mockUser);
    });

    it('should return admin user', async () => {
      const mockAdmin = {
        id: '2',
        email: 'admin@example.com',
        is_admin: true,
        created_at: '2024-01-01T00:00:00Z',
      };
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockAdmin });

      const result = await getCurrentUser();

      expect(result.is_admin).toBe(true);
    });

    it('should propagate errors on failed fetch', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Unauthorized'));

      await expect(getCurrentUser()).rejects.toThrow('Unauthorized');
    });
  });
});
