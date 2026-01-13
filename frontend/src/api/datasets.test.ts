import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getDatasets,
  getDataset,
  updateDataset,
  deleteDataset,
  toggleVisibility,
  getDatasetGeoJSON,
  uploadVector,
  uploadRaster,
  getGeoJSONUrl,
  getRasterTileUrl,
} from './datasets';
import { apiClient, uploadClient } from './client';

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

const mockDataset = {
  id: '1',
  name: 'Test Dataset',
  description: 'Test description',
  data_type: 'vector',
  geometry_type: 'Point',
  source_format: 'geojson',
  srid: 4326,
  is_visible: true,
  style_config: {},
  created_at: '2024-01-01T00:00:00Z',
};

describe('datasets API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getDatasets', () => {
    it('should fetch datasets with default params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { datasets: [mockDataset], total: 1, page: 1, per_page: 100 },
      });

      const result = await getDatasets();

      expect(apiClient.get).toHaveBeenCalledWith('/datasets/', {
        params: { skip: 0, limit: 100, visible_only: false },
      });
      expect(result.datasets).toHaveLength(1);
    });

    it('should fetch datasets with custom params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: { datasets: [], total: 0, page: 1, per_page: 20 },
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
      expect(formData.get('file')).toBe(file);
      expect(formData.get('name')).toBe('My Dataset');
      expect(formData.get('description')).toBe('My description');
    });
  });

  describe('uploadRaster', () => {
    it('should upload raster file with name only using uploadClient', async () => {
      const rasterDataset = { ...mockDataset, data_type: 'raster' };
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
      const rasterDataset = { ...mockDataset, data_type: 'raster' };
      vi.mocked(uploadClient.post).mockResolvedValue({ data: rasterDataset });

      const file = new File(['data'], 'test.tif');
      await uploadRaster(file, 'Raster Dataset', 'A description');

      const [, formData] = vi.mocked(uploadClient.post).mock.calls[0];
      expect(formData).toBeInstanceOf(FormData);
    });

    it('should include file, name and description in FormData', async () => {
      const rasterDataset = { ...mockDataset, data_type: 'raster' };
      vi.mocked(uploadClient.post).mockResolvedValue({ data: rasterDataset });

      const file = new File(['raster content'], 'image.tif', { type: 'image/tiff' });
      await uploadRaster(file, 'My Raster', 'Raster description');

      const [, formData] = vi.mocked(uploadClient.post).mock.calls[0];
      expect(formData).toBeInstanceOf(FormData);
      expect(formData.get('file')).toBe(file);
      expect(formData.get('name')).toBe('My Raster');
      expect(formData.get('description')).toBe('Raster description');
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
});
