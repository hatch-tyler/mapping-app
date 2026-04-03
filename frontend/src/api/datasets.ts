import { apiClient, uploadClient, API_URL } from './client';
import { getAccessToken } from './tokenService';
import axios, { AxiosProgressEvent } from 'axios';
import {
  Dataset,
  DatasetListResponse,
  DatasetFilters,
  GeoJSONFeatureCollection,
  FieldMetadataResponse,
  FeatureQueryResponse,
  ColumnFilter,
  ExportSelectedRequest,
  UploadJob,
  UniqueValuesResponse,
  FieldStatisticsResponse,
  RasterBandStatistics,
} from './types';

// Create a client without auth interceptors for public endpoints
const publicClient = axios.create({
  baseURL: `${API_URL}/api/v1`,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add optional auth header if token exists
publicClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export async function getDatasets(
  skip = 0,
  limit = 100,
  visibleOnly = false,
  filters?: DatasetFilters
): Promise<DatasetListResponse> {
  const params: Record<string, unknown> = { skip, limit, visible_only: visibleOnly };
  if (filters) {
    if (filters.search) params.search = filters.search;
    if (filters.category) params.category = filters.category;
    if (filters.source_type) params.source_type = filters.source_type;
    if (filters.geographic_scope) params.geographic_scope = filters.geographic_scope;
    if (filters.data_type) params.data_type = filters.data_type;
    if (filters.tags) params.tags = filters.tags;
    if (filters.project_id) params.project_id = filters.project_id;
  }
  const response = await apiClient.get<DatasetListResponse>('/datasets/', {
    params,
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

export interface UploadOptions {
  category?: string;
  geographic_scope?: string;
  project_id?: string;
  tags?: string;
}

export async function uploadVector(
  file: File,
  name: string,
  description?: string,
  onUploadProgress?: (event: AxiosProgressEvent) => void,
  options?: UploadOptions
): Promise<UploadJob> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('name', name);
  if (description) {
    formData.append('description', description);
  }
  if (options?.category) formData.append('category', options.category);
  if (options?.geographic_scope) formData.append('geographic_scope', options.geographic_scope);
  if (options?.project_id) formData.append('project_id', options.project_id);
  if (options?.tags) formData.append('tags', options.tags);

  const response = await uploadClient.post<UploadJob>('/upload/vector', formData, {
    onUploadProgress,
  });
  return response.data;
}

export async function uploadRaster(
  file: File,
  name: string,
  description?: string,
  onUploadProgress?: (event: AxiosProgressEvent) => void,
  options?: UploadOptions
): Promise<UploadJob> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('name', name);
  if (description) {
    formData.append('description', description);
  }
  if (options?.category) formData.append('category', options.category);
  if (options?.geographic_scope) formData.append('geographic_scope', options.geographic_scope);
  if (options?.project_id) formData.append('project_id', options.project_id);
  if (options?.tags) formData.append('tags', options.tags);

  const response = await uploadClient.post<UploadJob>('/upload/raster', formData, {
    onUploadProgress,
  });
  return response.data;
}

export async function getUploadJobStatus(jobId: string): Promise<UploadJob> {
  const response = await apiClient.get<UploadJob>(`/upload/status/${jobId}`);
  return response.data;
}

export function getGeoJSONUrl(datasetId: string, bbox?: string): string {
  // Use window.location.origin for share URLs so users get a full URL they can copy
  const baseUrl = API_URL || window.location.origin;
  const url = `${baseUrl}/api/v1/datasets/${datasetId}/geojson`;
  return bbox ? `${url}?bbox=${bbox}` : url;
}

export function getRasterTileUrl(datasetId: string, cacheKey?: string): string {
  const base = `${API_URL}/api/v1/raster/${datasetId}/tiles/{z}/{x}/{y}.png`;
  return cacheKey ? `${base}?s=${cacheKey}` : base;
}

export function getRasterExportUrl(datasetId: string, format: 'tif' | 'png' | 'jpg'): string {
  return `${API_URL}/api/v1/export/${datasetId}/raster/${format}`;
}

export function getMVTTileUrl(datasetId: string): string {
  return `${API_URL}/api/v1/datasets/${datasetId}/tiles/{z}/{x}/{y}.pbf`;
}

export function getWFSUrl(): string {
  const baseUrl = API_URL || window.location.origin;
  return `${baseUrl}/api/v1/wfs`;
}

export function getWFSFeatureTypeName(datasetId: string): string {
  return `gis:${datasetId}`;
}

// Export URLs for downloading data in various formats
export function getExportUrl(datasetId: string, format: 'geojson' | 'gpkg' | 'shp' | 'kml'): string {
  const baseUrl = API_URL || window.location.origin;
  return `${baseUrl}/api/v1/export/${datasetId}/${format}`;
}

// Proxy URL for external data sources
export function getExternalProxyUrl(datasetId: string): string {
  const baseUrl = API_URL || window.location.origin;
  return `${baseUrl}/api/v1/external-sources/${datasetId}/proxy`;
}

// Export URL for external vector datasets (fetches from remote service and converts)
export function getExternalExportUrl(datasetId: string, format: 'geojson' | 'gpkg' | 'shp' | 'kml'): string {
  const baseUrl = API_URL || window.location.origin;
  return `${baseUrl}/api/v1/export/external/${datasetId}/${format}`;
}

export const EXPORT_FORMATS = [
  { id: 'gpkg', name: 'GeoPackage', ext: '.gpkg', description: 'Best for ArcGIS Pro & QGIS' },
  { id: 'shp', name: 'Shapefile', ext: '.zip', description: 'Universal compatibility' },
  { id: 'geojson', name: 'GeoJSON', ext: '.geojson', description: 'Web applications & APIs' },
  { id: 'kml', name: 'KML', ext: '.kml', description: 'Google Earth' },
] as const;

// Convert dataset name to URL-safe slug
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^\w\s-]/g, '').replace(/[-\s]+/g, '_').trim();
}

export function getArcGISFeatureServerUrl(datasetName: string): string {
  const slug = slugify(datasetName);
  // Use window.location.origin for share URLs so users get a full URL they can copy
  const baseUrl = API_URL || window.location.origin;
  return `${baseUrl}/arcgis/rest/services/${encodeURIComponent(slug)}/FeatureServer/0`;
}

// ===== Browsable Datasets API =====

export async function getBrowsableDatasets(
  skip = 0,
  limit = 100
): Promise<DatasetListResponse> {
  const response = await publicClient.get<DatasetListResponse>('/datasets/browse', {
    params: { skip, limit },
  });
  return response.data;
}

export async function getDatasetFields(
  datasetId: string
): Promise<FieldMetadataResponse> {
  const response = await publicClient.get<FieldMetadataResponse>(
    `/datasets/${datasetId}/fields`
  );
  return response.data;
}

export async function queryFeatures(
  datasetId: string,
  page: number,
  pageSize: number,
  sortField?: string,
  sortOrder?: 'asc' | 'desc',
  filters?: ColumnFilter[]
): Promise<FeatureQueryResponse> {
  const params: Record<string, unknown> = {
    page,
    page_size: pageSize,
  };

  if (sortField) {
    params.sort_field = sortField;
    params.sort_order = sortOrder || 'asc';
  }

  if (filters && filters.length > 0) {
    params.filters = JSON.stringify(filters);
  }

  const response = await publicClient.get<FeatureQueryResponse>(
    `/datasets/${datasetId}/features`,
    { params }
  );
  return response.data;
}

export async function exportSelectedFeatures(
  datasetId: string,
  featureIds: number[],
  format: 'csv' | 'geojson'
): Promise<Blob> {
  const response = await publicClient.post<Blob>(
    `/export/${datasetId}/selected`,
    { feature_ids: featureIds, format } as ExportSelectedRequest,
    { responseType: 'blob' }
  );
  return response.data;
}

// ===== Style/Symbology API =====

export async function getUniqueValues(
  datasetId: string,
  fieldName: string,
  limit: number = 100
): Promise<UniqueValuesResponse> {
  const response = await publicClient.get<UniqueValuesResponse>(
    `/datasets/${datasetId}/fields/${encodeURIComponent(fieldName)}/unique-values`,
    { params: { limit } }
  );
  return response.data;
}

export async function getFieldStatistics(
  datasetId: string,
  fieldName: string
): Promise<FieldStatisticsResponse> {
  const response = await publicClient.get<FieldStatisticsResponse>(
    `/datasets/${datasetId}/fields/${encodeURIComponent(fieldName)}/statistics`
  );
  return response.data;
}

// ===== Raster Stats API =====

export async function getRasterStats(
  datasetId: string,
  band: number = 1
): Promise<RasterBandStatistics> {
  const response = await publicClient.get<RasterBandStatistics>(
    `/raster/${datasetId}/stats`,
    { params: { band } }
  );
  return response.data;
}
