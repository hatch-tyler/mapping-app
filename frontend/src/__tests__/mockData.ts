import { Dataset, User, FieldMetadata, FeatureRow, FeatureQueryResponse, FieldMetadataResponse } from '../api/types';

// Helper to create a complete Dataset mock with all required fields
export function createMockDataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: '1',
    name: 'Test Dataset',
    description: 'Test description',
    data_type: 'vector',
    geometry_type: 'Point',
    source_format: 'geojson',
    srid: 4326,
    bounds: [-180, -90, 180, 90],
    is_visible: true,
    is_public: false,
    style_config: {},
    min_zoom: 0,
    max_zoom: 22,
    file_path: null,
    table_name: 'dataset_1',
    feature_count: 100,
    created_by_id: 'user-1',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

// Helper to create a complete User mock with all required fields
export function createMockUser(overrides: Partial<User> = {}): User {
  return {
    id: '1',
    email: 'test@example.com',
    full_name: 'Test User',
    is_active: true,
    is_admin: false,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

// Helper to create mock field metadata
export function createMockFieldMetadata(overrides: Partial<FieldMetadata> = {}): FieldMetadata {
  return {
    name: 'field1',
    field_type: 'string',
    ...overrides,
  };
}

// Helper to create mock feature row
export function createMockFeatureRow(overrides: Partial<FeatureRow> = {}): FeatureRow {
  return {
    id: 1,
    properties: { name: 'Feature 1', value: 100 },
    ...overrides,
  };
}

// Helper to create mock feature query response
export function createMockFeatureQueryResponse(
  overrides: Partial<FeatureQueryResponse> = {}
): FeatureQueryResponse {
  return {
    features: [createMockFeatureRow()],
    total_count: 1,
    page: 1,
    page_size: 100,
    total_pages: 1,
    ...overrides,
  };
}

// Helper to create mock field metadata response
export function createMockFieldMetadataResponse(
  overrides: Partial<FieldMetadataResponse> = {}
): FieldMetadataResponse {
  return {
    dataset_id: '1',
    fields: [
      { name: 'name', field_type: 'string' },
      { name: 'value', field_type: 'number' },
    ],
    ...overrides,
  };
}

// Pre-built mock datasets for common test scenarios
export const mockVectorDataset = createMockDataset({
  id: '1',
  name: 'Test Vector Dataset',
  data_type: 'vector',
  geometry_type: 'Point',
  source_format: 'geojson',
  feature_count: 100,
});

export const mockRasterDataset = createMockDataset({
  id: '2',
  name: 'Test Raster Dataset',
  data_type: 'raster',
  geometry_type: null,
  source_format: 'geotiff',
  feature_count: null,
  table_name: null,
});

export const mockPublicDataset = createMockDataset({
  id: '3',
  name: 'Public Dataset',
  is_public: true,
  is_visible: true,
});

export const mockAdminUser = createMockUser({
  id: 'admin-1',
  email: 'admin@example.com',
  full_name: 'Admin User',
  is_admin: true,
});

export const mockRegularUser = createMockUser({
  id: 'user-1',
  email: 'user@example.com',
  full_name: 'Regular User',
  is_admin: false,
});
