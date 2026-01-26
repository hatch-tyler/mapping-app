import { apiClient } from './client';

export interface RegistrationRequest {
  email: string;
  password: string;
  full_name?: string;
}

export interface RegistrationRequestItem {
  id: string;
  email: string;
  full_name: string | null;
  status: string;
  rejection_reason: string | null;
  created_at: string;
  processed_at: string | null;
}

export interface RegistrationRequestListResponse {
  requests: RegistrationRequestItem[];
  total: number;
}

export async function submitRegistrationRequest(
  data: RegistrationRequest
): Promise<{ message: string; email: string }> {
  try {
    const response = await apiClient.post('/registration/request', data);
    return response.data;
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'response' in error) {
      const axiosError = error as { response?: { data?: { detail?: string } } };
      if (axiosError.response?.data?.detail) {
        throw new Error(axiosError.response.data.detail);
      }
    }
    throw new Error('Failed to submit registration request');
  }
}

export async function getRegistrationRequests(
  pendingOnly = true,
  skip = 0,
  limit = 100
): Promise<RegistrationRequestListResponse> {
  const response = await apiClient.get('/registration/requests', {
    params: { pending_only: pendingOnly, skip, limit },
  });
  return response.data;
}

export async function approveRegistrationRequest(
  id: string
): Promise<RegistrationRequestItem> {
  const response = await apiClient.post(`/registration/requests/${id}/approve`);
  return response.data;
}

export async function rejectRegistrationRequest(
  id: string,
  reason?: string
): Promise<RegistrationRequestItem> {
  const response = await apiClient.post(`/registration/requests/${id}/reject`, {
    reason,
  });
  return response.data;
}
