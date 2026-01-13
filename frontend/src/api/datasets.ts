import { apiClient, uploadClient, API_URL } from './client';
import { Dataset, DatasetListResponse, GeoJSONFeatureCollection } from './types';

export async function getDatasets(
  skip = 0,
  limit = 100,
  visibleOnly = false
): Promise<DatasetListResponse> {
  const response = await apiClient.get<DatasetListResponse>('/datasets/', {
    params: { skip, limit, visible_only: visibleOnly },
  });
  return response.data;
}

export async function getDataset(id: string): Promise<Dataset> {
  const response = await apiClient.get<Dataset>(`/datasets/${id}`);
  return response.data;
}

export async function updateDataset(
  id: string,
  data: Partial<Dataset>
): Promise<Dataset> {
  const response = await apiClient.put<Dataset>(`/datasets/${id}`, data);
  return response.data;
}

export async function deleteDataset(id: string): Promise<void> {
  await apiClient.delete(`/datasets/${id}`);
}

export async function toggleVisibility(
  id: string,
  isVisible: boolean
): Promise<Dataset> {
  const response = await apiClient.patch<Dataset>(`/datasets/${id}/visibility`, {
    is_visible: isVisible,
  });
  return response.data;
}

export async function togglePublicStatus(
  id: string,
  isPublic: boolean
): Promise<Dataset> {
  const response = await apiClient.patch<Dataset>(`/datasets/${id}/public`, {
    is_public: isPublic,
  });
  return response.data;
}

export async function getDatasetGeoJSON(
  id: string,
  bbox?: string
): Promise<GeoJSONFeatureCollection> {
  const response = await apiClient.get<GeoJSONFeatureCollection>(
    `/datasets/${id}/geojson`,
    {
      params: bbox ? { bbox } : undefined,
    }
  );
  return response.data;
}

export async function uploadVector(
  file: File,
  name: string,
  description?: string
): Promise<Dataset> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('name', name);
  if (description) {
    formData.append('description', description);
  }

  const response = await uploadClient.post<Dataset>('/upload/vector', formData);
  return response.data;
}

export async function uploadRaster(
  file: File,
  name: string,
  description?: string
): Promise<Dataset> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('name', name);
  if (description) {
    formData.append('description', description);
  }

  const response = await uploadClient.post<Dataset>('/upload/raster', formData);
  return response.data;
}

export function getGeoJSONUrl(datasetId: string, bbox?: string): string {
  const url = `${API_URL}/api/v1/datasets/${datasetId}/geojson`;
  return bbox ? `${url}?bbox=${bbox}` : url;
}

export function getRasterTileUrl(datasetId: string): string {
  return `${API_URL}/api/v1/raster/${datasetId}/tiles/{z}/{x}/{y}.png`;
}

export function getWFSUrl(): string {
  return `${API_URL}/api/v1/wfs`;
}

export function getWFSFeatureTypeName(datasetId: string): string {
  return `gis:${datasetId}`;
}

// Export URLs for downloading data in various formats
export function getExportUrl(datasetId: string, format: 'geojson' | 'gpkg' | 'shp' | 'kml'): string {
  return `${API_URL}/api/v1/export/${datasetId}/${format}`;
}

export const EXPORT_FORMATS = [
  { id: 'gpkg', name: 'GeoPackage', ext: '.gpkg', description: 'Best for ArcGIS Pro & QGIS' },
  { id: 'shp', name: 'Shapefile', ext: '.zip', description: 'Universal compatibility' },
  { id: 'geojson', name: 'GeoJSON', ext: '.geojson', description: 'Web applications & APIs' },
  { id: 'kml', name: 'KML', ext: '.kml', description: 'Google Earth' },
] as const;
