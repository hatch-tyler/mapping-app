import { apiClient } from './client';
import { User, UserRole } from './types';

export interface UserListParams {
  skip?: number;
  limit?: number;
  role?: UserRole;
  is_active?: boolean;
  search?: string;
}

export interface AdminUserUpdateData {
  role?: UserRole;
  is_active?: boolean;
  full_name?: string;
}

export async function getUsers(params?: UserListParams): Promise<User[]> {
  const response = await apiClient.get<User[]>('/users/', { params });
  return response.data;
}

export async function getUser(userId: string): Promise<User> {
  const response = await apiClient.get<User>(`/users/${userId}`);
  return response.data;
}

export async function updateUser(userId: string, data: AdminUserUpdateData): Promise<User> {
  const response = await apiClient.patch<User>(`/users/${userId}`, data);
  return response.data;
}

export async function deleteUser(userId: string): Promise<void> {
  await apiClient.delete(`/users/${userId}`);
}
