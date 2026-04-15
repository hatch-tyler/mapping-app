export type UserRole = 'admin' | 'editor' | 'viewer';

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
  is_admin: boolean;
  role: UserRole;
  created_at: string;
}

export type DatasetCategory = 'reference' | 'project';
export type GeographicScope = 'federal' | 'state' | 'county' | 'local';
export type SourceType = 'local' | 'external';

export interface Dataset {
  id: string;
  name: string;
  description: string | null;
  data_type: 'vector' | 'raster';
  geometry_type: string | null;
  source_format: string;
  srid: number;
  bounds: number[] | null;
  is_visible: boolean;
  is_public: boolean;
  style_config: Record<string, unknown>;
  min_zoom: number;
  max_zoom: number;
  file_path: string | null;
  table_name: string | null;
  feature_count: number | null;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
  // Organization fields
  source_type: SourceType;
  category: DatasetCategory;
  geographic_scope: GeographicScope | null;
  service_url: string | null;
  service_type: string | null;
  service_layer_id: string | null;
  project_id: string | null;
  project_name: string | null;
  linked_project_ids: string[];
  linked_project_names: string[];
  service_metadata: Record<string, unknown> | null;
  is_privileged: boolean;
  file_hash: string | null;
  snapshot_source_id: string | null;
  snapshot_date: string | null;
  tags: string[];
}

export interface DatasetFilters {
  search?: string;
  category?: DatasetCategory;
  source_type?: SourceType;
  geographic_scope?: GeographicScope;
  data_type?: 'vector' | 'raster';
  tags?: string;
  project_id?: string;
}

export interface DatasetListResponse {
  datasets: Dataset[];
  total: number;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  member_count: number;
  dataset_count: number;
}

export interface ProjectMember {
  id: string;
  user_id: string;
  role: 'owner' | 'editor' | 'viewer';
  created_at: string;
  user_email: string | null;
  user_name: string | null;
}

export interface ProjectDetail extends Project {
  members: ProjectMember[];
}

export interface ServiceCatalog {
  id: string;
  name: string;
  base_url: string;
  description: string | null;
  created_at: string;
}

export interface BrowseServiceInfo {
  name: string;
  full_name: string;
  type: string;
  url: string;
}

export interface BrowseResponse {
  url: string;
  folders: string[];
  services: BrowseServiceInfo[];
}

export interface ProjectListResponse {
  projects: Project[];
  total: number;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

// GeoJSON Geometry types (simplified - no need for @types/geojson)
export interface GeoJSONPoint {
  type: 'Point';
  coordinates: [number, number] | [number, number, number];
}

export interface GeoJSONLineString {
  type: 'LineString';
  coordinates: Array<[number, number] | [number, number, number]>;
}

export interface GeoJSONPolygon {
  type: 'Polygon';
  coordinates: Array<Array<[number, number] | [number, number, number]>>;
}

export interface GeoJSONMultiPoint {
  type: 'MultiPoint';
  coordinates: Array<[number, number] | [number, number, number]>;
}

export interface GeoJSONMultiLineString {
  type: 'MultiLineString';
  coordinates: Array<Array<[number, number] | [number, number, number]>>;
}

export interface GeoJSONMultiPolygon {
  type: 'MultiPolygon';
  coordinates: Array<Array<Array<[number, number] | [number, number, number]>>>;
}

export type GeoJSONGeometry =
  | GeoJSONPoint
  | GeoJSONLineString
  | GeoJSONPolygon
  | GeoJSONMultiPoint
  | GeoJSONMultiLineString
  | GeoJSONMultiPolygon;

export interface GeoJSONFeature {
  type: 'Feature';
  id?: number | string;
  geometry: GeoJSONGeometry;
  properties: Record<string, unknown>;
}

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

// ===== Feature Query Types =====

export interface FieldMetadata {
  name: string;
  field_type: 'string' | 'number' | 'boolean' | 'date' | 'null';
}

export interface FieldMetadataResponse {
  dataset_id: string;
  fields: FieldMetadata[];
}

export interface FeatureRow {
  id: number;
  properties: Record<string, unknown>;
}

export interface FeatureQueryResponse {
  features: FeatureRow[];
  total_count: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export type FilterOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'startswith';

export interface ColumnFilter {
  field: string;
  operator: FilterOperator;
  value: string | number | boolean;
}

export interface ExportSelectedRequest {
  feature_ids: number[];
  format: 'csv' | 'geojson';
}

export interface UploadJob {
  id: string;
  dataset_id: string;
  bundle_id?: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface DetectedDatasetApi {
  suggested_name: string;
  data_type: 'vector' | 'raster';
  format: string;
  primary_file: string;
  member_files: string[];
  warnings: string[];
}

export interface BundleInspectResponse {
  datasets: DetectedDatasetApi[];
}

export interface BundleDatasetInput {
  primary_file: string;
  name: string;
  description?: string | null;
  include: boolean;
}

export interface BundleUploadResponse {
  bundle_id: string;
  jobs: UploadJob[];
}

export interface BundleJobDetail {
  id: string;
  dataset_id: string;
  dataset_name: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface BundleStatusResponse {
  bundle_id: string;
  jobs: BundleJobDetail[];
}

export interface BundleSummary {
  bundle_id: string;
  created_at: string;
  total: number;
  completed: number;
  failed: number;
  in_progress: number;
}

// ===== Style Configuration Types =====

export type RGBAColor = [number, number, number, number];

export type StyleMode = 'uniform' | 'categorical' | 'graduated';

export interface ColorRampConfig {
  name: string;
  minValue?: number;
  maxValue?: number;
  numClasses?: number;
}

export interface StyleConfig {
  mode: StyleMode;

  // Uniform styling (base colors)
  fillColor: RGBAColor;
  lineColor: RGBAColor;
  lineWidth: number;
  pointRadius: number;
  pointRadiusMinPixels: number;
  pointRadiusMaxPixels: number;

  // Attribute-based styling
  attributeField?: string;

  // Categorical mode
  categoryColors?: Record<string, RGBAColor>;
  defaultCategoryColor?: RGBAColor;

  // Graduated mode
  colorRamp?: ColorRampConfig;
}

export interface UniqueValuesResponse {
  field: string;
  values: (string | number | boolean | null)[];
  total_count: number;
}

export interface FieldStatisticsResponse {
  field: string;
  min: number | null;
  max: number | null;
  mean: number | null;
  count: number;
}

// ===== Raster Style Types =====

export type RasterMode = 'continuous' | 'classified';

export interface RasterValueEntry {
  color: RGBAColor;
  label: string;
}

export interface RasterStyleConfig {
  raster_mode: RasterMode;
  band: number;
  color_ramp?: string;
  min_value?: number;
  max_value?: number;
  value_map?: Record<string, RasterValueEntry>;
  nodata_transparent: boolean;
}

export interface RasterBandStatistics {
  band: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  std: number | null;
  nodata_value: number | null;
  dtype: string;
  unique_values: number[] | null;
  has_embedded_colormap: boolean;
  rat: Record<string, { label: string; fields?: Record<string, string | null> }> | null;
}
