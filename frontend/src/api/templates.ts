import { apiClient } from './client';

export type DisplayUnit = 'in' | 'mm';

export interface LayoutTemplate {
  id: string;
  name: string;
  description: string | null;
  project_id: string | null;
  page_config: {
    width: number;
    height: number;
    orientation: 'landscape' | 'portrait';
    margins?: { top: number; right: number; bottom: number; left: number };
    displayUnit?: DisplayUnit;
  };
  elements: LayoutElement[];
  logo_path: string | null;
  source_file_path: string | null;
  source_format: 'qpt' | 'pagx' | null;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface LayoutElement {
  type:
    | 'map_frame'
    | 'title'
    | 'subtitle'
    | 'legend'
    | 'scale_bar'
    | 'north_arrow'
    | 'logo'
    | 'image'
    | 'shape'
    | 'text'
    | 'horizontal_rule'
    | 'horizontal_rule'
    | 'header_decorator'
    | 'footer_decorator'
    | 'graticule'
    | 'inset_map'
    | 'table';
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  textAlign?: 'left' | 'center' | 'right';
  fontWeight?: 'normal' | 'bold';
  textColor?: string;
  units?: string;
  color?: string;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  thickness?: number;
  imageData?: string;
  opacity?: number;       // 0-100, default 100
  rotation?: number;      // degrees, default 0
  locked?: boolean;       // prevent move/resize when true
  // Table properties
  tableRows?: number;
  tableCols?: number;
  tableData?: string[][]; // row-major cell content
  // Graticule properties
  gridInterval?: number;  // interval in degrees or meters
  gridColor?: string;
  showLabels?: boolean;
}

export interface MapView {
  id: string;
  name: string;
  description: string | null;
  project_id: string | null;
  map_config: {
    zoom: number;
    latitude: number;
    longitude: number;
    bearing: number;
    pitch: number;
    basemap: string;
  };
  layer_configs: { dataset_id: string; visible: boolean }[];
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
}

// Layout Templates

export async function getLayoutTemplates(projectId?: string): Promise<LayoutTemplate[]> {
  const params = projectId ? { project_id: projectId } : {};
  const response = await apiClient.get<LayoutTemplate[]>('/layout-templates/', { params });
  return response.data;
}

export async function createLayoutTemplate(data: {
  name: string;
  description?: string;
  project_id?: string;
  page_config: LayoutTemplate['page_config'];
  elements: LayoutElement[];
}): Promise<LayoutTemplate> {
  const response = await apiClient.post<LayoutTemplate>('/layout-templates/', data);
  return response.data;
}

export async function updateLayoutTemplate(
  id: string,
  data: Partial<{ name: string; description: string; page_config: LayoutTemplate['page_config']; elements: LayoutElement[] }>
): Promise<LayoutTemplate> {
  const response = await apiClient.put<LayoutTemplate>(`/layout-templates/${id}`, data);
  return response.data;
}

export async function deleteLayoutTemplate(id: string): Promise<void> {
  await apiClient.delete(`/layout-templates/${id}`);
}

export async function importLayoutTemplate(
  file: File,
  name: string,
  description?: string,
  projectId?: string,
): Promise<LayoutTemplate> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('name', name);
  if (description) formData.append('description', description);
  if (projectId) formData.append('project_id', projectId);
  const response = await apiClient.post<LayoutTemplate>('/layout-templates/import', formData);
  return response.data;
}

export async function downloadOriginalTemplate(id: string, name: string, format: string): Promise<void> {
  const response = await apiClient.get(`/layout-templates/${id}/download`, {
    responseType: 'blob',
  });
  const url = URL.createObjectURL(response.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}

export function getLayoutExportUrl(id: string, format: 'qpt' | 'pagx'): string {
  return `${apiClient.defaults.baseURL}/layout-templates/${id}/export/${format}`;
}

export async function downloadLayoutExport(id: string, format: 'qpt' | 'pagx'): Promise<void> {
  const response = await apiClient.get(`/layout-templates/${id}/export/${format}`, {
    responseType: 'blob',
  });
  const contentDisposition = response.headers['content-disposition'];
  const filename = contentDisposition?.match(/filename="?(.+?)"?$/)?.[1] || `layout.${format}`;
  const url = URL.createObjectURL(response.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Map Views

export async function getMapViews(projectId?: string): Promise<MapView[]> {
  const params = projectId ? { project_id: projectId } : {};
  const response = await apiClient.get<MapView[]>('/map-views/', { params });
  return response.data;
}

export async function createMapView(data: {
  name: string;
  description?: string;
  project_id?: string;
  map_config: MapView['map_config'];
  layer_configs: MapView['layer_configs'];
}): Promise<MapView> {
  const response = await apiClient.post<MapView>('/map-views/', data);
  return response.data;
}

export async function updateMapView(
  id: string,
  data: Partial<{
    name: string;
    description: string | null;
    project_id: string | null;
    map_config: MapView['map_config'];
    layer_configs: MapView['layer_configs'];
  }>
): Promise<MapView> {
  const response = await apiClient.put<MapView>(`/map-views/${id}`, data);
  return response.data;
}

export async function deleteMapView(id: string): Promise<void> {
  await apiClient.delete(`/map-views/${id}`);
}

// Style Exports

export function getStyleExportUrl(datasetId: string, format: 'sld' | 'lyrx' | 'qml'): string {
  return `${apiClient.defaults.baseURL}/export/datasets/${datasetId}/style/${format}`;
}

export async function downloadStyleExport(datasetId: string, format: 'sld' | 'lyrx' | 'qml'): Promise<void> {
  const response = await apiClient.get(`/export/datasets/${datasetId}/style/${format}`, {
    responseType: 'blob',
  });
  const contentDisposition = response.headers['content-disposition'];
  const filename = contentDisposition?.match(/filename="?(.+?)"?$/)?.[1] || `style.${format}`;
  const url = URL.createObjectURL(response.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
