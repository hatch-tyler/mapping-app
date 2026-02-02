import { apiClient } from './client';
import { TokenResponse, LoginRequest, User } from './types';

export async function login(data: LoginRequest): Promise<TokenResponse> {
  const response = await apiClient.post<TokenResponse>('/auth/login', data);
  return response.data;
}

export async function logout(refreshToken: string): Promise<void> {
  await apiClient.post('/auth/logout', { refresh_token: refreshToken });
}

export async function refreshToken(token: string): Promise<TokenResponse> {
  const response = await apiClient.post<TokenResponse>('/auth/refresh', {
    refresh_token: token,
  });
  return response.data;
}

export async function getCurrentUser(): Promise<User> {
  const response = await apiClient.get<User>('/users/me');
  return response.data;
}

export interface ConfirmEmailResponse {
  message: string;
  email: string;
}

export async function confirmEmail(token: string): Promise<ConfirmEmailResponse> {
  const response = await apiClient.get<ConfirmEmailResponse>(`/auth/confirm/${token}`);
  return response.data;
}

export interface ResendConfirmationResponse {
  message: string;
}

export async function resendConfirmation(email: string): Promise<ResendConfirmationResponse> {
  const response = await apiClient.post<ResendConfirmationResponse>('/auth/resend-confirmation', {
    email,
  });
  return response.data;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiClient.post('/users/me/change-password', {
    current_password: currentPassword,
    new_password: newPassword,
  });
}
