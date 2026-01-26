import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getDatasets,
  getDataset,
  updateDataset,
  deleteDataset,
  toggleVisibility,
  togglePublicStatus,
  getDatasetGeoJSON,
  uploadVector,
  uploadRaster,
  getGeoJSONUrl,
  getRasterTileUrl,
  getWFSUrl,
  getWFSFeatureTypeName,
  getExportUrl,
  getArcGISFeatureServerUrl,
  EXPORT_FORMATS,
} from './datasets';
import { apiClient, uploadClient } from './client';
import { createMockDataset } from '../__tests__/mockData';

// Mock the apiClient and uploadClient
vi.mock('./client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  uploadClient: {
    post: vi.fn(),
  },
  API_URL: 'http://localhost:8000',
}));

// Mock axios for publicClient
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      get: vi.fn(),
      post: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
    })),
  },
}));

const mockDataset = createMockDataset({
  id: '1',
  name: 'Test Dataset',
  description: 'Test description',
});

describe('datasets API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getDatasets', () => {
    it('should fetch datasets with default params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { datasets: [mockDataset], total: 1 },
      });

      const result = await getDatasets();

      expect(apiClient.get).toHaveBeenCalledWith('/datasets/', {
        params: { skip: 0, limit: 100, visible_only: false },
      });
      expect(result.datasets).toHaveLength(1);
    });

    it('should fetch datasets with custom params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { datasets: [], total: 0 },
      });

      await getDatasets(20, 20, true);

      expect(apiClient.get).toHaveBeenCalledWith('/datasets/', {
        params: { skip: 20, limit: 20, visible_only: true },
      });
    });
  });

  describe('getDataset', () => {
    it('should fetch a single dataset', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockDataset });

      const result = await getDataset('1');

      expect(apiClient.get).toHaveBeenCalledWith('/datasets/1');
      expect(result).toEqual(mockDataset);
    });
  });

  describe('updateDataset', () => {
    it('should update a dataset', async () => {
      const updatedDataset = { ...mockDataset, name: 'Updated Name' };
      vi.mocked(apiClient.put).mockResolvedValue({ data: updatedDataset });

      const result = await updateDataset('1', { name: 'Updated Name' });

      expect(apiClient.put).toHaveBeenCalledWith('/datasets/1', { name: 'Updated Name' });
      expect(result.name).toBe('Updated Name');
    });
  });

  describe('deleteDataset', () => {
    it('should delete a dataset', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({});

      await deleteDataset('1');

      expect(apiClient.delete).toHaveBeenCalledWith('/datasets/1');
    });
  });

  describe('toggleVisibility', () => {
    it('should toggle visibility to true', async () => {
      const visibleDataset = { ...mockDataset, is_visible: true };
      vi.mocked(apiClient.patch).mockResolvedValue({ data: visibleDataset });

      const result = await toggleVisibility('1', true);

      expect(apiClient.patch).toHaveBeenCalledWith('/datasets/1/visibility', {
        is_visible: true,
      });
      expect(result.is_visible).toBe(true);
    });

    it('should toggle visibility to false', async () => {
      const hiddenDataset = { ...mockDataset, is_visible: false };
      vi.mocked(apiClient.patch).mockResolvedValue({ data: hiddenDataset });

      const result = await toggleVisibility('1', false);

      expect(apiClient.patch).toHaveBeenCalledWith('/datasets/1/visibility', {
        is_visible: false,
      });
      expect(result.is_visible).toBe(false);
    });
  });

  describe('getDatasetGeoJSON', () => {
    it('should fetch GeoJSON without bbox', async () => {
      const geoJson = { type: 'FeatureCollection', features: [] };
      vi.mocked(apiClient.get).mockResolvedValue({ data: geoJson });

      const result = await getDatasetGeoJSON('1');

      expect(apiClient.get).toHaveBeenCalledWith('/datasets/1/geojson', {
        params: undefined,
      });
      expect(result).toEqual(geoJson);
    });

    it('should fetch GeoJSON with bbox', async () => {
      const geoJson = { type: 'FeatureCollection', features: [] };
      vi.mocked(apiClient.get).mockResolvedValue({ data: geoJson });

      await getDatasetGeoJSON('1', '-180,-90,180,90');

      expect(apiClient.get).toHaveBeenCalledWith('/datasets/1/geojson', {
        params: { bbox: '-180,-90,180,90' },
      });
    });
  });

  describe('uploadVector', () => {
    it('should upload vector file with name only using uploadClient', async () => {
      vi.mocked(uploadClient.post).mockResolvedValue({ data: mockDataset });

      const file = new File(['data'], 'test.geojson');
      const result = await uploadVector(file, 'Test Dataset');

      // Should use uploadClient (not apiClient) for uploads
      expect(uploadClient.post).toHaveBeenCalled();
      expect(apiClient.post).not.toHaveBeenCalled();
      const [url, formData] = vi.mocked(uploadClient.post).mock.calls[0];
      expect(url).toBe('/upload/vector');
      expect(formData).toBeInstanceOf(FormData);
      expect(result).toEqual(mockDataset);
    });

    it('should upload vector file with name and description', async () => {
      vi.mocked(uploadClient.post).mockResolvedValue({ data: mockDataset });

      const file = new File(['data'], 'test.geojson');
      await uploadVector(file, 'Test Dataset', 'A description');

      const [, formData] = vi.mocked(uploadClient.post).mock.calls[0];
      expect(formData).toBeInstanceOf(FormData);
    });

    it('should include file, name and description in FormData', async () => {
      vi.mocked(uploadClient.post).mockResolvedValue({ data: mockDataset });

      const file = new File(['test content'], 'data.geojson', { type: 'application/json' });
      await uploadVector(file, 'My Dataset', 'My description');

      const [, formData] = vi.mocked(uploadClient.post).mock.calls[0];
      expect(formData).toBeInstanceOf(FormData);
      expect((formData as FormData).get('file')).toBe(file);
      expect((formData as FormData).get('name')).toBe('My Dataset');
      expect((formData as FormData).get('description')).toBe('My description');
    });
  });

  describe('uploadRaster', () => {
    it('should upload raster file with name only using uploadClient', async () => {
      const rasterDataset = createMockDataset({ data_type: 'raster' });
      vi.mocked(uploadClient.post).mockResolvedValue({ data: rasterDataset });

      const file = new File(['data'], 'test.tif');
      const result = await uploadRaster(file, 'Raster Dataset');

      // Should use uploadClient (not apiClient) for uploads
      expect(uploadClient.post).toHaveBeenCalled();
      expect(apiClient.post).not.toHaveBeenCalled();
      const [url, formData] = vi.mocked(uploadClient.post).mock.calls[0];
      expect(url).toBe('/upload/raster');
      expect(formData).toBeInstanceOf(FormData);
      expect(result.data_type).toBe('raster');
    });

    it('should upload raster file with name and description', async () => {
      const rasterDataset = createMockDataset({ data_type: 'raster' });
      vi.mocked(uploadClient.post).mockResolvedValue({ data: rasterDataset });

      const file = new File(['data'], 'test.tif');
      await uploadRaster(file, 'Raster Dataset', 'A description');

      const [, formData] = vi.mocked(uploadClient.post).mock.calls[0];
      expect(formData).toBeInstanceOf(FormData);
    });

    it('should include file, name and description in FormData', async () => {
      const rasterDataset = createMockDataset({ data_type: 'raster' });
      vi.mocked(uploadClient.post).mockResolvedValue({ data: rasterDataset });

      const file = new File(['raster content'], 'image.tif', { type: 'image/tiff' });
      await uploadRaster(file, 'My Raster', 'Raster description');

      const [, formData] = vi.mocked(uploadClient.post).mock.calls[0];
      expect(formData).toBeInstanceOf(FormData);
      expect((formData as FormData).get('file')).toBe(file);
      expect((formData as FormData).get('name')).toBe('My Raster');
      expect((formData as FormData).get('description')).toBe('Raster description');
    });
  });

  describe('getGeoJSONUrl', () => {
    it('should return correct URL without bbox', () => {
      const url = getGeoJSONUrl('dataset-123');

      expect(url).toBe('http://localhost:8000/api/v1/datasets/dataset-123/geojson');
    });

    it('should return correct URL with bbox', () => {
      const url = getGeoJSONUrl('dataset-123', '-180,-90,180,90');

      expect(url).toBe(
        'http://localhost:8000/api/v1/datasets/dataset-123/geojson?bbox=-180,-90,180,90'
      );
    });
  });

  describe('getRasterTileUrl', () => {
    it('should return correct tile URL template', () => {
      const url = getRasterTileUrl('raster-456');

      expect(url).toBe(
        'http://localhost:8000/api/v1/raster/raster-456/tiles/{z}/{x}/{y}.png'
      );
    });
  });

  describe('togglePublicStatus', () => {
    it('should toggle public status to true', async () => {
      const publicDataset = { ...mockDataset, is_public: true };
      vi.mocked(apiClient.patch).mockResolvedValue({ data: publicDataset });

      const result = await togglePublicStatus('1', true);

      expect(apiClient.patch).toHaveBeenCalledWith('/datasets/1/public', {
        is_public: true,
      });
      expect(result.is_public).toBe(true);
    });

    it('should toggle public status to false', async () => {
      const privateDataset = { ...mockDataset, is_public: false };
      vi.mocked(apiClient.patch).mockResolvedValue({ data: privateDataset });

      const result = await togglePublicStatus('1', false);

      expect(apiClient.patch).toHaveBeenCalledWith('/datasets/1/public', {
        is_public: false,
      });
      expect(result.is_public).toBe(false);
    });
  });

  describe('getWFSUrl', () => {
    it('should return correct WFS URL', () => {
      const url = getWFSUrl();
      expect(url).toBe('http://localhost:8000/api/v1/wfs');
    });
  });

  describe('getWFSFeatureTypeName', () => {
    it('should return feature type name with gis prefix', () => {
      const featureType = getWFSFeatureTypeName('dataset-123');
      expect(featureType).toBe('gis:dataset-123');
    });
  });

  describe('getExportUrl', () => {
    it('should return correct export URL for geojson format', () => {
      const url = getExportUrl('dataset-123', 'geojson');
      expect(url).toBe('http://localhost:8000/api/v1/export/dataset-123/geojson');
    });

    it('should return correct export URL for gpkg format', () => {
      const url = getExportUrl('dataset-123', 'gpkg');
      expect(url).toBe('http://localhost:8000/api/v1/export/dataset-123/gpkg');
    });

    it('should return correct export URL for shp format', () => {
      const url = getExportUrl('dataset-123', 'shp');
      expect(url).toBe('http://localhost:8000/api/v1/export/dataset-123/shp');
    });

    it('should return correct export URL for kml format', () => {
      const url = getExportUrl('dataset-123', 'kml');
      expect(url).toBe('http://localhost:8000/api/v1/export/dataset-123/kml');
    });
  });

  describe('getArcGISFeatureServerUrl', () => {
    it('should return correct ArcGIS FeatureServer URL', () => {
      const url = getArcGISFeatureServerUrl('Test Dataset');
      expect(url).toBe('http://localhost:8000/arcgis/rest/services/test_dataset/FeatureServer/0');
    });

    it('should slugify dataset name with special characters', () => {
      const url = getArcGISFeatureServerUrl('My Test Dataset (2024)!');
      expect(url).toBe('http://localhost:8000/arcgis/rest/services/my_test_dataset_2024/FeatureServer/0');
    });

    it('should handle multiple spaces in dataset name', () => {
      const url = getArcGISFeatureServerUrl('Test   Multiple   Spaces');
      expect(url).toBe('http://localhost:8000/arcgis/rest/services/test_multiple_spaces/FeatureServer/0');
    });
  });

  describe('EXPORT_FORMATS', () => {
    it('should have correct export formats defined', () => {
      expect(EXPORT_FORMATS).toHaveLength(4);
      expect(EXPORT_FORMATS.map(f => f.id)).toEqual(['gpkg', 'shp', 'geojson', 'kml']);
    });

    it('should have gpkg as first format', () => {
      expect(EXPORT_FORMATS[0].id).toBe('gpkg');
      expect(EXPORT_FORMATS[0].name).toBe('GeoPackage');
      expect(EXPORT_FORMATS[0].ext).toBe('.gpkg');
    });

    it('should have correct extensions for all formats', () => {
      const extensions = EXPORT_FORMATS.map(f => f.ext);
      expect(extensions).toEqual(['.gpkg', '.zip', '.geojson', '.kml']);
    });
  });
});
