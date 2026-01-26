import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  submitRegistrationRequest,
  getRegistrationRequests,
  approveRegistrationRequest,
  rejectRegistrationRequest,
} from './registration';
import { apiClient } from './client';

// Mock the apiClient
vi.mock('./client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe('registration API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('submitRegistrationRequest', () => {
    it('should submit registration request', async () => {
      const mockResponse = { message: 'Request submitted', email: 'test@example.com' };
      vi.mocked(apiClient.post).mockResolvedValue({ data: mockResponse });

      const result = await submitRegistrationRequest({
        email: 'test@example.com',
        password: 'password123',
        full_name: 'Test User',
      });

      expect(apiClient.post).toHaveBeenCalledWith('/registration/request', {
        email: 'test@example.com',
        password: 'password123',
        full_name: 'Test User',
      });
      expect(result).toEqual(mockResponse);
    });

    it('should throw error with detail message on failure', async () => {
      const error = {
        response: {
          data: { detail: 'Email already exists' },
        },
      };
      vi.mocked(apiClient.post).mockRejectedValue(error);

      await expect(
        submitRegistrationRequest({
          email: 'test@example.com',
          password: 'password123',
        })
      ).rejects.toThrow('Email already exists');
    });

    it('should throw generic error when no detail available', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Network error'));

      await expect(
        submitRegistrationRequest({
          email: 'test@example.com',
          password: 'password123',
        })
      ).rejects.toThrow('Failed to submit registration request');
    });
  });

  describe('getRegistrationRequests', () => {
    it('should fetch registration requests with default params', async () => {
      const mockResponse = {
        requests: [
          {
            id: '1',
            email: 'test@example.com',
            full_name: 'Test User',
            status: 'pending',
            rejection_reason: null,
            created_at: '2024-01-01T00:00:00Z',
            processed_at: null,
          },
        ],
        total: 1,
      };
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockResponse });

      const result = await getRegistrationRequests();

      expect(apiClient.get).toHaveBeenCalledWith('/registration/requests', {
        params: { pending_only: true, skip: 0, limit: 100 },
      });
      expect(result).toEqual(mockResponse);
    });

    it('should fetch registration requests with custom params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: { requests: [], total: 0 } });

      await getRegistrationRequests(false, 10, 50);

      expect(apiClient.get).toHaveBeenCalledWith('/registration/requests', {
        params: { pending_only: false, skip: 10, limit: 50 },
      });
    });
  });

  describe('approveRegistrationRequest', () => {
    it('should approve registration request', async () => {
      const mockResponse = {
        id: '1',
        email: 'test@example.com',
        full_name: 'Test User',
        status: 'approved',
        rejection_reason: null,
        created_at: '2024-01-01T00:00:00Z',
        processed_at: '2024-01-02T00:00:00Z',
      };
      vi.mocked(apiClient.post).mockResolvedValue({ data: mockResponse });

      const result = await approveRegistrationRequest('1');

      expect(apiClient.post).toHaveBeenCalledWith('/registration/requests/1/approve');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('rejectRegistrationRequest', () => {
    it('should reject registration request without reason', async () => {
      const mockResponse = {
        id: '1',
        email: 'test@example.com',
        full_name: 'Test User',
        status: 'rejected',
        rejection_reason: null,
        created_at: '2024-01-01T00:00:00Z',
        processed_at: '2024-01-02T00:00:00Z',
      };
      vi.mocked(apiClient.post).mockResolvedValue({ data: mockResponse });

      const result = await rejectRegistrationRequest('1');

      expect(apiClient.post).toHaveBeenCalledWith('/registration/requests/1/reject', {
        reason: undefined,
      });
      expect(result).toEqual(mockResponse);
    });

    it('should reject registration request with reason', async () => {
      const mockResponse = {
        id: '1',
        email: 'test@example.com',
        full_name: 'Test User',
        status: 'rejected',
        rejection_reason: 'Invalid email domain',
        created_at: '2024-01-01T00:00:00Z',
        processed_at: '2024-01-02T00:00:00Z',
      };
      vi.mocked(apiClient.post).mockResolvedValue({ data: mockResponse });

      const result = await rejectRegistrationRequest('1', 'Invalid email domain');

      expect(apiClient.post).toHaveBeenCalledWith('/registration/requests/1/reject', {
        reason: 'Invalid email domain',
      });
      expect(result).toEqual(mockResponse);
    });
  });
});
