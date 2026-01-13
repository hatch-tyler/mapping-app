import { describe, it, expect, vi } from 'vitest';
import { createLayerFromDataset, getLayerColor } from './layerFactory';
import { Dataset } from '../api/types';

// Mock deck.gl modules
vi.mock('@deck.gl/layers', () => ({
  GeoJsonLayer: vi.fn().mockImplementation((props) => ({
    ...props,
    type: 'GeoJsonLayer',
  })),
  BitmapLayer: vi.fn().mockImplementation((props) => ({
    ...props,
    type: 'BitmapLayer',
  })),
}));

vi.mock('@deck.gl/geo-layers', () => ({
  TileLayer: vi.fn().mockImplementation((props) => ({
    ...props,
    type: 'TileLayer',
  })),
}));

vi.mock('../api/datasets', () => ({
  getGeoJSONUrl: vi.fn((id) => `http://localhost:8000/api/v1/datasets/${id}/geojson`),
  getRasterTileUrl: vi.fn((id) => `http://localhost:8000/api/v1/raster/${id}/tiles/{z}/{x}/{y}.png`),
}));

describe('layerFactory', () => {
  describe('createLayerFromDataset', () => {
    const mockVectorDataset: Dataset = {
      id: 'vector-1',
      name: 'Vector Dataset',
      description: null,
      data_type: 'vector',
      geometry_type: 'Polygon',
      source_format: 'geojson',
      srid: 4326,
      is_visible: true,
      style_config: {},
      created_at: '2024-01-01T00:00:00Z',
    };

    const mockRasterDataset: Dataset = {
      id: 'raster-1',
      name: 'Raster Dataset',
      description: null,
      data_type: 'raster',
      geometry_type: null,
      source_format: 'geotiff',
      srid: 4326,
      is_visible: true,
      style_config: {},
      min_zoom: 0,
      max_zoom: 18,
      created_at: '2024-01-01T00:00:00Z',
    };

    it('should create GeoJsonLayer for vector dataset', () => {
      const layer = createLayerFromDataset(mockVectorDataset);

      expect(layer).not.toBeNull();
      expect(layer?.id).toBe('vector-vector-1');
      expect((layer as { type: string })?.type).toBe('GeoJsonLayer');
    });

    it('should create TileLayer for raster dataset', () => {
      const layer = createLayerFromDataset(mockRasterDataset);

      expect(layer).not.toBeNull();
      expect(layer?.id).toBe('raster-raster-1');
      expect((layer as { type: string })?.type).toBe('TileLayer');
    });

    it('should return null for unknown data type', () => {
      const unknownDataset = {
        ...mockVectorDataset,
        data_type: 'unknown' as 'vector',
      };

      const layer = createLayerFromDataset(unknownDataset);

      expect(layer).toBeNull();
    });

    it('should use provided data for vector layer', () => {
      const geoJsonData = {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            properties: { name: 'Test' },
            geometry: {
              type: 'Point' as const,
              coordinates: [0, 0],
            },
          },
        ],
      };

      const layer = createLayerFromDataset(mockVectorDataset, geoJsonData);

      expect(layer).not.toBeNull();
      expect((layer as { data: unknown })?.data).toEqual(geoJsonData);
    });

    it('should use URL when no data provided for vector layer', () => {
      const layer = createLayerFromDataset(mockVectorDataset);

      expect(layer).not.toBeNull();
      expect((layer as { data: string })?.data).toContain('geojson');
    });

    it('should apply custom style config for vector layer', () => {
      const styledDataset: Dataset = {
        ...mockVectorDataset,
        style_config: {
          fillColor: [255, 0, 0, 255],
          lineColor: [0, 0, 255, 255],
        },
      };

      const layer = createLayerFromDataset(styledDataset);

      expect(layer).not.toBeNull();
      // The style should be merged with defaults
    });

    it('should set pickable to true for vector layers', () => {
      const layer = createLayerFromDataset(mockVectorDataset);

      expect((layer as { pickable: boolean })?.pickable).toBe(true);
    });

    it('should set stroked and filled to true for vector layers', () => {
      const layer = createLayerFromDataset(mockVectorDataset);

      expect((layer as { stroked: boolean })?.stroked).toBe(true);
      expect((layer as { filled: boolean })?.filled).toBe(true);
    });

    it('should use min and max zoom for raster layers', () => {
      const layer = createLayerFromDataset(mockRasterDataset);

      expect((layer as { minZoom: number })?.minZoom).toBe(0);
      expect((layer as { maxZoom: number })?.maxZoom).toBe(18);
    });

    it('should set tileSize for raster layers', () => {
      const layer = createLayerFromDataset(mockRasterDataset);

      expect((layer as { tileSize: number })?.tileSize).toBe(256);
    });

    it('should have renderSubLayers function for raster layers', () => {
      const layer = createLayerFromDataset(mockRasterDataset);

      expect((layer as { renderSubLayers: unknown })?.renderSubLayers).toBeDefined();
      expect(typeof (layer as { renderSubLayers: unknown })?.renderSubLayers).toBe('function');
    });
  });

  describe('getLayerColor', () => {
    it('should return first color for index 0', () => {
      const color = getLayerColor(0);

      expect(color).toEqual([66, 133, 244, 180]);
    });

    it('should return second color for index 1', () => {
      const color = getLayerColor(1);

      expect(color).toEqual([52, 168, 83, 180]);
    });

    it('should cycle back to first color after all colors used', () => {
      const color0 = getLayerColor(0);
      const color8 = getLayerColor(8);

      expect(color0).toEqual(color8);
    });

    it('should cycle correctly for large indices', () => {
      const color = getLayerColor(100);
      const expectedIndex = 100 % 8;

      // The color at index 100 % 8 = 4 is [154, 160, 166, 180]
      expect(color).toEqual([154, 160, 166, 180]);
    });

    it('should return RGBA color tuple', () => {
      const color = getLayerColor(0);

      expect(color).toHaveLength(4);
      expect(color.every((c) => typeof c === 'number')).toBe(true);
      expect(color.every((c) => c >= 0 && c <= 255)).toBe(true);
    });

    it('should return different colors for different indices', () => {
      const colors = Array.from({ length: 8 }, (_, i) => getLayerColor(i));
      const uniqueColors = new Set(colors.map((c) => c.join(',')));

      expect(uniqueColors.size).toBe(8);
    });
  });
});
