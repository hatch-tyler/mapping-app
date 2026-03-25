import { apiClient } from './client';
import { Dataset, ServiceCatalog, BrowseResponse } from './types';

export interface ExternalServiceLayer {
  id: string;
  name: string;
  geometry_type: string | null;
  extent: number[] | null;
}

export interface ProbeResponse {
  service_type: string;
  layers: ExternalServiceLayer[];
  capabilities_url: string;
}

export async function probeService(url: string): Promise<ProbeResponse> {
  const response = await apiClient.post<ProbeResponse>('/external-sources/probe', { url });
  return response.data;
}

export async function browseDirectory(url: string): Promise<BrowseResponse> {
  const response = await apiClient.post<BrowseResponse>('/external-sources/browse', { url });
  return response.data;
}

export interface RegisterRequest {
  name: string;
  description?: string;
  service_url: string;
  service_type: string;
  service_layer_id: string;
  category?: string;
  geographic_scope?: string;
  project_id?: string;
  tags?: string[];
}

export async function registerExternalSource(data: RegisterRequest): Promise<Dataset> {
  const response = await apiClient.post<Dataset>('/external-sources/register', data);
  return response.data;
}

export async function validateExternalSource(datasetId: string): Promise<{ status: string; detail: string }> {
  const response = await apiClient.post<{ status: string; detail: string }>(
    `/external-sources/${datasetId}/validate`
  );
  return response.data;
}

// Catalog CRUD
export async function getCatalogs(): Promise<{ catalogs: ServiceCatalog[] }> {
  const response = await apiClient.get<{ catalogs: ServiceCatalog[] }>('/external-sources/catalogs');
  return response.data;
}

export async function createCatalog(data: { name: string; base_url: string; description?: string }): Promise<ServiceCatalog> {
  const response = await apiClient.post<ServiceCatalog>('/external-sources/catalogs', data);
  return response.data;
}

export async function deleteCatalog(id: string): Promise<void> {
  await apiClient.delete(`/external-sources/catalogs/${id}`);
}
