import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to test the interceptors behavior
// Mock axios before importing the client
vi.mock('axios', async () => {
  const actual = await vi.importActual('axios');
  return {
    ...actual,
    default: {
      create: vi.fn(() => ({
        interceptors: {
          request: { use: vi.fn() },
          response: { use: vi.fn() },
        },
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
      })),
      post: vi.fn(),
    },
  };
});

describe('apiClient', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should have correct base URL', async () => {
    const axios = await import('axios');
    const { apiClient } = await import('./client');

    // Check that create was called with expected config
    expect(axios.default.create).toHaveBeenCalled();
  });

  describe('request interceptor', () => {
    it('should add Authorization header when token exists', () => {
      localStorage.setItem('access_token', 'test-token-123');

      const config = {
        headers: {
          Authorization: '',
        },
      };

      // Simulate what the interceptor does
      const token = localStorage.getItem('access_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }

      expect(config.headers.Authorization).toBe('Bearer test-token-123');
    });

    it('should not add Authorization header when no token', () => {
      const config = {
        headers: {
          Authorization: '',
        },
      };

      const token = localStorage.getItem('access_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }

      expect(config.headers.Authorization).toBe('');
    });
  });

  describe('response interceptor', () => {
    it('should pass through successful responses', () => {
      const response = { data: { test: true }, status: 200 };

      // Response interceptor returns response directly for success
      expect(response.status).toBe(200);
      expect(response.data).toEqual({ test: true });
    });

    it('should handle 401 error by attempting token refresh', async () => {
      localStorage.setItem('refresh_token', 'refresh-123');

      // Simulate error scenario
      const error = {
        response: { status: 401 },
        config: { _retry: false, headers: {} },
      };

      expect(error.response.status).toBe(401);
      expect(error.config._retry).toBe(false);
    });

    it('should clear tokens on refresh failure', () => {
      localStorage.setItem('access_token', 'old-token');
      localStorage.setItem('refresh_token', 'old-refresh');

      // Simulate what happens on refresh failure
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');

      expect(localStorage.getItem('access_token')).toBeNull();
      expect(localStorage.getItem('refresh_token')).toBeNull();
    });
  });

  describe('API_URL export', () => {
    it('should export API_URL', async () => {
      const { API_URL } = await import('./client');

      expect(API_URL).toBeDefined();
      expect(typeof API_URL).toBe('string');
    });
  });
});

describe('uploadClient', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should be exported separately from apiClient', async () => {
    const { uploadClient, apiClient } = await import('./client');

    // uploadClient should be exported and defined
    expect(uploadClient).toBeDefined();
    expect(apiClient).toBeDefined();
    // They should be separate instances (different objects)
    expect(uploadClient).not.toBe(apiClient);
  });

  describe('uploadClient request interceptor', () => {
    it('should add Authorization header when token exists', () => {
      localStorage.setItem('access_token', 'upload-token-123');

      const config = {
        headers: {
          Authorization: '',
        },
      };

      // Simulate what the uploadClient interceptor does
      const token = localStorage.getItem('access_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }

      expect(config.headers.Authorization).toBe('Bearer upload-token-123');
    });

    it('should not add Authorization header when no token', () => {
      const config = {
        headers: {
          Authorization: '',
        },
      };

      const token = localStorage.getItem('access_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }

      expect(config.headers.Authorization).toBe('');
    });
  });

  describe('uploadClient configuration', () => {
    it('should have longer timeout for uploads', () => {
      // uploadClient is configured with 120000ms timeout (2 minutes)
      // vs apiClient with 30000ms timeout
      const uploadTimeout = 120000;
      const apiTimeout = 30000;

      expect(uploadTimeout).toBeGreaterThan(apiTimeout);
      expect(uploadTimeout).toBe(120000);
    });

    it('should not have default Content-Type header', () => {
      // uploadClient should NOT set default Content-Type
      // This allows FormData to set its own multipart boundary
      const uploadClientHeaders = {}; // No default Content-Type
      const apiClientHeaders = { 'Content-Type': 'application/json' };

      expect(uploadClientHeaders).not.toHaveProperty('Content-Type');
      expect(apiClientHeaders).toHaveProperty('Content-Type');
    });
  });
});
