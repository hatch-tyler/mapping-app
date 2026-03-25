import { apiClient } from './client';
import { Project, ProjectDetail, ProjectListResponse, ProjectMember } from './types';

export async function getProjects(skip = 0, limit = 100): Promise<ProjectListResponse> {
  const response = await apiClient.get<ProjectListResponse>('/projects/', {
    params: { skip, limit },
  });
  return response.data;
}

export async function getProject(id: string): Promise<ProjectDetail> {
  const response = await apiClient.get<ProjectDetail>(`/projects/${id}`);
  return response.data;
}

export async function createProject(data: { name: string; description?: string }): Promise<Project> {
  const response = await apiClient.post<Project>('/projects/', data);
  return response.data;
}

export async function updateProject(
  id: string,
  data: { name?: string; description?: string; is_active?: boolean }
): Promise<Project> {
  const response = await apiClient.put<Project>(`/projects/${id}`, data);
  return response.data;
}

export async function deleteProject(id: string): Promise<void> {
  await apiClient.delete(`/projects/${id}`);
}

export async function addMember(
  projectId: string,
  userId: string,
  role: string = 'viewer'
): Promise<ProjectMember> {
  const response = await apiClient.post<ProjectMember>(
    `/projects/${projectId}/members`,
    { user_id: userId, role }
  );
  return response.data;
}

export async function updateMemberRole(
  projectId: string,
  userId: string,
  role: string
): Promise<ProjectMember> {
  const response = await apiClient.patch<ProjectMember>(
    `/projects/${projectId}/members/${userId}`,
    { role }
  );
  return response.data;
}

export async function removeMember(projectId: string, userId: string): Promise<void> {
  await apiClient.delete(`/projects/${projectId}/members/${userId}`);
}
