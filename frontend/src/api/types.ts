export interface User {
  id: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
  is_admin: boolean;
  created_at: string;
}

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
}

export interface DatasetListResponse {
  datasets: Dataset[];
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
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
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
